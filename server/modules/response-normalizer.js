import { logServerWarn } from './server-logger.js';
import {
    invalidModelOutputResult,
    successfulModelResult,
} from './chat-model-result.js';

const ALLOWED_EMOTIONS = new Set(['normal', 'happy', 'confused', 'angry']);
const SAFE_NORMALIZATION_NUMBER_KEYS = [
    'promptSnapshotLength',
    'historyMessageCount',
    'outputLimit',
];
const SAFE_NORMALIZATION_BOOLEAN_KEYS = [
    'hasAuthenticatedUser',
    'hasFinishReason',
    'hasPromptBlockReason',
];

const buildSafeNormalizationLogContext = (value) => {
    if (!value || typeof value !== 'object') return {};
    const safe = {};
    if (typeof value.traceId === 'string' && /^[a-z0-9-]{1,80}$/i.test(value.traceId)) {
        safe.traceId = value.traceId;
    }
    for (const key of SAFE_NORMALIZATION_NUMBER_KEYS) {
        const parsed = Number(value[key]);
        if (Number.isFinite(parsed) && parsed >= 0) safe[key] = Math.floor(parsed);
    }
    for (const key of SAFE_NORMALIZATION_BOOLEAN_KEYS) {
        if (typeof value[key] === 'boolean') safe[key] = value[key];
    }
    return safe;
};

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
        character_image_slot: {
            type: 'STRING',
        },
        world_image_slot: {
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
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
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
    const safeLogContext = buildSafeNormalizationLogContext(logContext);

    if (!rawText || typeof rawText !== 'string') {
        logServerWarn('[V-MATE] Invalid empty structured model output', safeLogContext);
        return invalidModelOutputResult();
    }

    const trimmedRawText = rawText.trim();
    const normalizedText = trimmedRawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const usedFenceRecovery = normalizedText !== trimmedRawText;

    let parsed = tryParseJsonObject(normalizedText);
    let parseMode = parsed ? (usedFenceRecovery ? 'fenced-full' : 'strict-full') : null;

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
        logServerWarn('[V-MATE] Invalid non-structured model output', {
            ...safeLogContext,
            rawTextLength: normalizedText.length,
        });
        return invalidModelOutputResult();
    }

    if (parseMode && parseMode !== 'strict-full') {
        logServerWarn('[V-MATE] JSON normalization used recovery parser', {
            ...safeLogContext,
            parseMode,
            rawTextLength: normalizedText.length,
        });
    }

    const hasRequiredContractFields =
        typeof parsed?.emotion === 'string' && Boolean(parsed.emotion.trim()) &&
        typeof parsed?.inner_heart === 'string' &&
        typeof parsed?.response === 'string' && Boolean(parsed.response.trim());

    if (!hasRequiredContractFields) {
        logServerWarn('[V-MATE] Parsed model output did not satisfy required contract fields', {
            ...safeLogContext,
            parseMode,
            rawTextLength: normalizedText.length,
        });
        return invalidModelOutputResult();
    }

    const emotion = parsed.emotion.trim().toLowerCase();

    const innerHeart = typeof parsed?.inner_heart === 'string'
        ? parsed.inner_heart.trim()
        : '';

    const response = parsed.response.trim();

    const narration = typeof parsed?.narration === 'string'
        ? parsed.narration.trim()
        : '';
    const characterImageSlot = typeof parsed?.character_image_slot === 'string'
        ? parsed.character_image_slot.trim()
        : '';
    const worldImageSlot = typeof parsed?.world_image_slot === 'string'
        ? parsed.world_image_slot.trim()
        : '';

    if (!ALLOWED_EMOTIONS.has(emotion)) {
        logServerWarn('[V-MATE] Invalid emotion value normalized to default', {
            ...safeLogContext,
            hadInvalidEmotion: true,
        });
        parseMode = 'invalid-emotion-recovery';
    }

    const value = {
        emotion: ALLOWED_EMOTIONS.has(emotion) ? emotion : 'normal',
        inner_heart: innerHeart,
        response,
        narration,
        ...(characterImageSlot ? { character_image_slot: characterImageSlot } : {}),
        ...(worldImageSlot ? { world_image_slot: worldImageSlot } : {}),
    };

    return successfulModelResult({
        value,
        parseMode: parseMode === 'strict-full' ? 'strict' : 'recovered',
    });
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
