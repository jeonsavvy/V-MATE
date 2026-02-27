import { logServerWarn } from './server-logger.js';

const ALLOWED_EMOTIONS = new Set(['normal', 'happy', 'confused', 'angry']);

export const JSON_RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        emotion: {
            type: 'STRING',
            enum: ['normal', 'happy', 'confused', 'angry'],
        },
        inner_heart: {
            type: 'STRING',
        },
        response: {
            type: 'STRING',
        },
        narration: {
            type: 'STRING',
        },
    },
    required: ['emotion', 'inner_heart', 'response'],
};

const tryParseJsonObject = (text) => {
    if (!text || typeof text !== 'string') {
        return null;
    }

    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const looksLikeBrokenContractJson = (text) => {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return false;
    }

    const mentionsContractKey = /["']?(emotion|inner_heart|response|narration)["']?\s*:?/i.test(normalized);
    const startsJsonLike = normalized.startsWith('{') || normalized.startsWith('[');

    if (!mentionsContractKey || !startsJsonLike) {
        return false;
    }

    const openCurly = (normalized.match(/{/g) || []).length;
    const closeCurly = (normalized.match(/}/g) || []).length;
    const openSquare = (normalized.match(/\[/g) || []).length;
    const closeSquare = (normalized.match(/]/g) || []).length;
    const hasUnbalancedBrackets = openCurly !== closeCurly || openSquare !== closeSquare;

    return hasUnbalancedBrackets || normalized.length < 40;
};

const tryParseLooseJsonObject = (text) => {
    if (!text || typeof text !== 'string') {
        return null;
    }

    const normalizedQuotes = text
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();

    const candidates = [normalizedQuotes];

    const quotedKeys = normalizedQuotes.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
    candidates.push(quotedKeys);

    const singleToDouble = quotedKeys.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, value) => {
        const escaped = String(value)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
        return `"${escaped}"`;
    });
    candidates.push(singleToDouble);

    const noTrailingComma = singleToDouble.replace(/,\s*([}\]])/g, '$1');
    candidates.push(noTrailingComma);

    for (const candidate of candidates) {
        const parsed = tryParseJsonObject(candidate);
        if (parsed) {
            return parsed;
        }
    }

    return null;
};

const extractJsonObjectCandidates = (text) => {
    const candidates = [];
    if (!text || typeof text !== 'string') {
        return candidates;
    }

    let depth = 0;
    let start = -1;
    let inString = false;
    let escaping = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];

        if (escaping) {
            escaping = false;
            continue;
        }

        if (ch === '\\') {
            escaping = true;
            continue;
        }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (ch === '{') {
            if (depth === 0) {
                start = i;
            }
            depth += 1;
            continue;
        }

        if (ch === '}') {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                candidates.push(text.slice(start, i + 1));
                start = -1;
            }
        }
    }

    return candidates;
};

export const normalizeAssistantPayload = (rawText, logContext = null) => {
    const safeFallback = {
        emotion: 'normal',
        inner_heart: '',
        response: '잠시 응답 형식이 불안정했어요. 한 번만 다시 말해줘.',
        narration: '',
    };
    const safeLogContext = logContext && typeof logContext === 'object' ? logContext : {};

    if (!rawText || typeof rawText !== 'string') {
        return safeFallback;
    }

    const normalizedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed = tryParseJsonObject(normalizedText);
    let parseMode = parsed ? 'strict-full' : null;

    if (!parsed) {
        parsed = tryParseLooseJsonObject(normalizedText);
        if (parsed) {
            parseMode = 'loose-full';
        }
    }

    if (!parsed) {
        const candidates = extractJsonObjectCandidates(normalizedText);
        for (const candidate of candidates) {
            const strictCandidate = tryParseJsonObject(candidate);
            if (strictCandidate) {
                parsed = strictCandidate;
                parseMode = 'strict-candidate';
                break;
            }

            const looseCandidate = tryParseLooseJsonObject(candidate);
            if (looseCandidate) {
                parsed = looseCandidate;
                parseMode = 'loose-candidate';
                break;
            }
        }
    }

    if (!parsed) {
        if (looksLikeBrokenContractJson(normalizedText)) {
            logServerWarn('[V-MATE] JSON normalization fallback (broken contract JSON)', {
                ...safeLogContext,
                rawTextLength: normalizedText.length,
            });
            return safeFallback;
        }

        const plainResponse = normalizedText
            .replace(/^here is (the )?json requested:?/i, '')
            .replace(/^json:?/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!plainResponse) {
            logServerWarn('[V-MATE] JSON normalization fallback (empty text)', {
                ...safeLogContext,
                rawTextLength: normalizedText.length,
            });
            return safeFallback;
        }

        logServerWarn('[V-MATE] JSON normalization fallback (plain text passthrough)', {
            ...safeLogContext,
            rawTextLength: normalizedText.length,
        });

        return {
            emotion: 'normal',
            inner_heart: '',
            response: plainResponse.slice(0, 520),
            narration: '',
        };
    }

    if (parseMode && parseMode !== 'strict-full') {
        logServerWarn('[V-MATE] JSON normalization used recovery parser', {
            ...safeLogContext,
            parseMode,
            rawTextLength: normalizedText.length,
        });
    }

    const emotion = typeof parsed?.emotion === 'string' && parsed.emotion.trim()
        ? parsed.emotion.trim().toLowerCase()
        : 'normal';

    const innerHeart = typeof parsed?.inner_heart === 'string'
        ? parsed.inner_heart.trim()
        : '';

    const response = typeof parsed?.response === 'string' && parsed.response.trim()
        ? parsed.response.trim()
        : safeFallback.response;

    const narration = typeof parsed?.narration === 'string'
        ? parsed.narration.trim()
        : '';

    if (!ALLOWED_EMOTIONS.has(emotion)) {
        logServerWarn('[V-MATE] Invalid emotion value normalized to default', {
            ...safeLogContext,
            emotion,
        });
    }

    if (response === safeFallback.response && typeof parsed?.response !== 'string') {
        logServerWarn('[V-MATE] Parsed JSON missing string response field', {
            ...safeLogContext,
            parseMode,
            rawTextLength: normalizedText.length,
        });
    }

    return {
        emotion: ALLOWED_EMOTIONS.has(emotion) ? emotion : 'normal',
        inner_heart: innerHeart,
        response,
        narration,
    };
};

export const extractGeminiResponseText = (geminiData) => {
    const candidates = Array.isArray(geminiData?.candidates) ? geminiData.candidates : [];

    for (const candidate of candidates) {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        const text = parts
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .filter(Boolean)
            .join('\n')
            .trim();

        if (text) {
            return text;
        }
    }

    return null;
};
