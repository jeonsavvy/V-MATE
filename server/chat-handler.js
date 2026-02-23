/**
 * Cloudflare Worker Chat Handler: Gemini API 중계 서버
 * - API key 은닉
 * - Origin allowlist 기반 CORS
 * - Origin/IP 기반 rate limit
 * - Gemini 응답 JSON 정규화
 */
import { createHash } from 'node:crypto';

const rateLimitStore = new Map();
const promptCacheStore = new Map();
const SUPPORTED_CHARACTER_IDS = new Set(['mika', 'alice', 'kael']);
const FIXED_GEMINI_MODEL_NAME = 'gemini-3-flash-preview';

const shouldUseGeminiContextCache = () =>
    String(process.env.GEMINI_CONTEXT_CACHE_ENABLED || 'true').toLowerCase() !== 'false';

const getGeminiContextCacheConfig = () => ({
    ttlSeconds: Number(process.env.GEMINI_CONTEXT_CACHE_TTL_SECONDS || 21600),
    createTimeoutMs: Number(process.env.GEMINI_CONTEXT_CACHE_CREATE_TIMEOUT_MS || 1800),
    warmupMinChars: Number(process.env.GEMINI_CONTEXT_CACHE_WARMUP_MIN_CHARS || 1200),
    autoCreateEnabled: String(process.env.GEMINI_CONTEXT_CACHE_AUTO_CREATE || 'false').toLowerCase() !== 'false',
});

const getGeminiRetryConfig = () => ({
    cacheLookupRetryEnabled:
        String(process.env.GEMINI_CACHE_LOOKUP_RETRY_ENABLED || 'true').toLowerCase() !== 'false',
    networkRecoveryRetryEnabled:
        String(process.env.GEMINI_NETWORK_RECOVERY_RETRY_ENABLED || 'true').toLowerCase() !== 'false',
    emptyResponseRetryEnabled:
        String(process.env.GEMINI_EMPTY_RESPONSE_RETRY_ENABLED || 'false').toLowerCase() === 'true',
});

const getGeminiThinkingLevel = () => {
    const raw = String(process.env.GEMINI_THINKING_LEVEL || 'minimal').trim().toLowerCase();
    const allowed = new Set(['minimal', 'low', 'medium', 'high']);
    return allowed.has(raw) ? raw : 'minimal';
};

const toStablePromptHash = (prompt) =>
    createHash('sha256')
        .update(String(prompt || ''))
        .digest('hex')
        .slice(0, 24);

const buildPromptCacheKey = (characterId, promptHash) => `${characterId}:${promptHash}`;

const getValidPromptCache = (cacheKey) => {
    const entry = promptCacheStore.get(cacheKey);
    if (!entry) {
        return null;
    }

    // 만료 15초 전부터는 재사용하지 않고 재생성 유도
    if (!entry.expireAtMs || Date.now() >= entry.expireAtMs - 15000) {
        promptCacheStore.delete(cacheKey);
        return null;
    }

    return entry;
};

const removePromptCache = (cacheKey) => {
    if (!cacheKey) return;
    promptCacheStore.delete(cacheKey);
};

const isValidCachedContentName = (value) => {
    const text = String(value || '').trim();
    if (!text.startsWith('cachedContents/')) {
        return false;
    }
    return /^[A-Za-z0-9/_\-.]+$/.test(text);
};

const parseCachedContentName = (value) => {
    const text = String(value || '').trim();
    return isValidCachedContentName(text) ? text : null;
};

const createPromptCacheEntry = async ({
    apiKey,
    modelName,
    characterId,
    systemPrompt,
    cacheKey,
}) => {
    const { ttlSeconds, createTimeoutMs } = getGeminiContextCacheConfig();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), createTimeoutMs);

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `models/${modelName}`,
                    displayName: `vmate-${characterId}-${cacheKey.slice(-8)}`,
                    ttl: `${Math.max(300, ttlSeconds)}s`,
                    systemInstruction: {
                        role: 'system',
                        parts: [{ text: String(systemPrompt) }],
                    },
                }),
                signal: controller.signal,
            }
        );

        let data;
        try {
            data = await response.json();
        } catch {
            return null;
        }

        if (!response.ok || data?.error || !data?.name) {
            return null;
        }

        const expireAtMs = data?.expireTime ? Date.parse(data.expireTime) : NaN;
        const safeExpireAtMs = Number.isFinite(expireAtMs)
            ? expireAtMs
            : Date.now() + Math.max(300, ttlSeconds) * 1000;

        const entry = {
            name: data.name,
            expireAtMs: safeExpireAtMs,
        };

        promptCacheStore.set(cacheKey, entry);
        return entry;
    } catch {
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
};

const parseAllowedOrigins = () => {
    const raw = (process.env.ALLOWED_ORIGINS || '').trim();
    if (!raw) {
        return new Set([
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'http://localhost:8888',
            'http://127.0.0.1:8888',
        ]);
    }

    return new Set(
        raw
            .split(',')
            .map((origin) => origin.trim().replace(/\/+$/, ''))
            .filter(Boolean)
    );
};

const normalizeOrigin = (origin) => String(origin || '').trim().replace(/\/+$/, '');

const shouldAllowAllOrigins = () => {
    return String(process.env.ALLOW_ALL_ORIGINS || 'false').toLowerCase() === 'true';
};

const isOriginAllowed = (origin) => {
    if (shouldAllowAllOrigins()) {
        return true;
    }

    if (!origin) {
        // 서버 간 호출/health check 같은 non-browser 호출 허용
        return true;
    }

    const normalized = normalizeOrigin(origin);
    const allowlist = parseAllowedOrigins();
    return allowlist.has(normalized);
};

const getClientKey = (event, origin) => {
    const forwardedFor = event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'];
    const ip = String(forwardedFor || '').split(',')[0].trim();
    if (ip) return `ip:${ip}`;

    if (origin) return `origin:${normalizeOrigin(origin)}`;
    return 'anonymous';
};

const getRateLimitConfig = () => {
    return {
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
        maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30),
    };
};

const checkRateLimit = (key) => {
    const { windowMs, maxRequests } = getRateLimitConfig();
    const now = Date.now();

    const existing = rateLimitStore.get(key);
    if (!existing || now > existing.resetAt) {
        const next = {
            count: 1,
            resetAt: now + windowMs,
        };
        rateLimitStore.set(key, next);
        return { allowed: true, remaining: maxRequests - 1, retryAfterMs: windowMs };
    }

    if (existing.count >= maxRequests) {
        return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(0, existing.resetAt - now),
        };
    }

    existing.count += 1;
    rateLimitStore.set(key, existing);
    return {
        allowed: true,
        remaining: Math.max(0, maxRequests - existing.count),
        retryAfterMs: Math.max(0, existing.resetAt - now),
    };
};

const buildHeaders = (originAllowed, origin) => {
    const resolvedOrigin = originAllowed ? (origin || '*') : 'null';

    return {
        'Access-Control-Allow-Origin': resolvedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin',
        'X-V-MATE-Function': 'chat-v4',
        'Content-Type': 'application/json',
    };
};

const withElapsedHeader = (headers, startedAtMs) => ({
    ...headers,
    'X-V-MATE-Elapsed-Ms': String(Math.max(0, Date.now() - startedAtMs)),
});

const buildErrorPayload = ({ error, errorCode, traceId, retryable = false, details }) => ({
    error,
    error_code: errorCode,
    trace_id: traceId,
    ...(retryable ? { retryable: true } : {}),
    ...(details ? { details } : {}),
});

const ALLOWED_EMOTIONS = new Set(['normal', 'happy', 'confused', 'angry']);
const JSON_RESPONSE_SCHEMA = {
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

const toSafeLogPreview = (value, maxChars = 160) => {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!text) {
        return '';
    }

    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
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

const normalizeAssistantPayload = (rawText, logContext = null) => {
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
            console.warn('[V-MATE] JSON normalization fallback (broken contract JSON)', {
                ...safeLogContext,
                rawTextLength: normalizedText.length,
                rawTextPreview: toSafeLogPreview(normalizedText),
            });
            return safeFallback;
        }

        const plainResponse = normalizedText
            .replace(/^here is (the )?json requested:?/i, '')
            .replace(/^json:?/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!plainResponse) {
            console.warn('[V-MATE] JSON normalization fallback (empty text)', {
                ...safeLogContext,
                rawTextLength: normalizedText.length,
            });
            return safeFallback;
        }

        console.warn('[V-MATE] JSON normalization fallback (plain text passthrough)', {
            ...safeLogContext,
            rawTextLength: normalizedText.length,
            rawTextPreview: toSafeLogPreview(normalizedText),
        });

        return {
            emotion: 'normal',
            inner_heart: '',
            response: plainResponse.slice(0, 520),
            narration: '',
        };
    }

    if (parseMode && parseMode !== 'strict-full') {
        console.warn('[V-MATE] JSON normalization used recovery parser', {
            ...safeLogContext,
            parseMode,
            rawTextLength: normalizedText.length,
            rawTextPreview: toSafeLogPreview(normalizedText),
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
        console.warn('[V-MATE] Invalid emotion value normalized to default', {
            ...safeLogContext,
            emotion,
        });
    }

    if (response === safeFallback.response && typeof parsed?.response !== 'string') {
        console.warn('[V-MATE] Parsed JSON missing string response field', {
            ...safeLogContext,
            parseMode,
            rawTextPreview: toSafeLogPreview(normalizedText),
        });
    }

    return {
        emotion: ALLOWED_EMOTIONS.has(emotion) ? emotion : 'normal',
        inner_heart: innerHeart,
        response,
        narration,
    };
};

const extractGeminiResponseText = (geminiData) => {
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

export const handler = async (event, context) => {
    const requestStartedAt = Date.now();
    const requestTraceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const origin = event.headers?.origin || event.headers?.Origin;
    const originAllowed = isOriginAllowed(origin);
    const headers = {
        ...buildHeaders(originAllowed, origin),
        'X-V-MATE-Trace-Id': requestTraceId,
    };

    // OPTIONS 요청 처리 (CORS preflight)
    if (event.httpMethod === 'OPTIONS') {
        if (!originAllowed) {
            return {
                statusCode: 403,
                headers: withElapsedHeader(headers, requestStartedAt),
                body: JSON.stringify({ error: 'Origin is not allowed.' }),
            };
        }

        return {
            statusCode: 200,
            headers: withElapsedHeader(headers, requestStartedAt),
            body: '',
        };
    }

    // POST 요청만 허용
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: withElapsedHeader(headers, requestStartedAt),
            body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }

    if (!originAllowed) {
        return {
            statusCode: 403,
            headers: withElapsedHeader(headers, requestStartedAt),
            body: JSON.stringify({ error: 'Origin is not allowed.' }),
        };
    }

    const rateKey = getClientKey(event, origin);
    const rateStatus = checkRateLimit(rateKey);
    if (!rateStatus.allowed) {
        return {
            statusCode: 429,
            headers: withElapsedHeader({
                ...headers,
                'Retry-After': String(Math.ceil(rateStatus.retryAfterMs / 1000)),
            }, requestStartedAt),
            body: JSON.stringify({
                error: 'Too many requests. Please try again later.',
            }),
        };
    }

    try {
        const apiKey = process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            return {
                statusCode: 500,
                headers: withElapsedHeader(headers, requestStartedAt),
                body: JSON.stringify(
                    buildErrorPayload({
                        error: 'API key not configured. Please set GOOGLE_API_KEY in runtime secrets.',
                        errorCode: 'SERVER_API_KEY_NOT_CONFIGURED',
                        traceId: requestTraceId,
                    })
                ),
            };
        }

        // 요청 본문 파싱 및 검증
        let requestData;
        try {
            requestData = JSON.parse(event.body);
        } catch (parseError) {
            return {
                statusCode: 400,
                headers: withElapsedHeader(headers, requestStartedAt),
                body: JSON.stringify(
                    buildErrorPayload({
                        error: 'Invalid request body. Expected JSON format.',
                        errorCode: 'INVALID_REQUEST_BODY',
                        traceId: requestTraceId,
                        details: parseError.message,
                    })
                ),
            };
        }

        const { systemPrompt, userMessage, messageHistory, characterId, cachedContent } = requestData;

        if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
            return {
                statusCode: 400,
                headers: withElapsedHeader(headers, requestStartedAt),
                body: JSON.stringify(
                    buildErrorPayload({
                        error: 'userMessage is required and must be a non-empty string.',
                        errorCode: 'INVALID_USER_MESSAGE',
                        traceId: requestTraceId,
                    })
                ),
            };
        }

        const MAX_HISTORY_MESSAGES = Number(process.env.GEMINI_HISTORY_MESSAGES || 10);
        const MAX_PART_CHARS = Number(process.env.GEMINI_MAX_PART_CHARS || 700);
        const MAX_SYSTEM_PROMPT_CHARS = Number(process.env.GEMINI_MAX_SYSTEM_PROMPT_CHARS || 5000);
        const PRIMARY_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 1024);
        const MODEL_TIMEOUT_MS = Number(process.env.GEMINI_MODEL_TIMEOUT_MS || 15000);
        const FUNCTION_TOTAL_TIMEOUT_MS = Number(process.env.FUNCTION_TOTAL_TIMEOUT_MS || 20000);
        const FUNCTION_TIMEOUT_GUARD_MS = Number(process.env.FUNCTION_TIMEOUT_GUARD_MS || 1500);
        const clampText = (value) => String(value ?? '').slice(0, MAX_PART_CHARS);
        const clampSystemPrompt = (value) => String(value ?? '').slice(0, MAX_SYSTEM_PROMPT_CHARS);

        const normalizedCharacterId = String(characterId || '').trim().toLowerCase();
        const requestCachedContent = parseCachedContentName(cachedContent);
        const trimmedSystemPrompt = String(systemPrompt || '').trim();
        const clampedSystemPrompt = trimmedSystemPrompt ? clampSystemPrompt(trimmedSystemPrompt) : '';
        const MODEL_NAME = FIXED_GEMINI_MODEL_NAME;
        const GEMINI_THINKING_LEVEL = getGeminiThinkingLevel();
        const {
            cacheLookupRetryEnabled,
            networkRecoveryRetryEnabled,
            emptyResponseRetryEnabled,
        } = getGeminiRetryConfig();
        const logMeta = {
            traceId: requestTraceId,
            characterId: normalizedCharacterId || null,
        };

        const canUseContextCache =
            shouldUseGeminiContextCache() &&
            Boolean(trimmedSystemPrompt) &&
            SUPPORTED_CHARACTER_IDS.has(normalizedCharacterId);

        let promptCacheKey = null;
        let cachedContentName = null;

        if (canUseContextCache) {
            const promptHash = toStablePromptHash(trimmedSystemPrompt);
            promptCacheKey = buildPromptCacheKey(normalizedCharacterId, promptHash);
            cachedContentName =
                requestCachedContent ||
                getValidPromptCache(promptCacheKey)?.name ||
                null;
        }

        const contents = [];

        if (messageHistory && Array.isArray(messageHistory)) {
            const recentHistory = messageHistory.slice(-MAX_HISTORY_MESSAGES);
            recentHistory.forEach((msg) => {
                if (msg.role === 'user') {
                    contents.push({ role: 'user', parts: [{ text: clampText(msg.content) }] });
                } else if (msg.role === 'assistant') {
                    const assistantText = typeof msg.content === 'object' ? msg.content.response : msg.content;
                    contents.push({ role: 'model', parts: [{ text: clampText(assistantText) }] });
                }
            });
        }

        contents.push({
            role: 'user',
            parts: [{ text: clampText(userMessage) }],
        });

        const getRemainingBudget = () =>
            FUNCTION_TOTAL_TIMEOUT_MS - (Date.now() - requestStartedAt);

        if (canUseContextCache && !cachedContentName) {
            const { warmupMinChars, autoCreateEnabled } = getGeminiContextCacheConfig();
            const hasEnoughBudgetForCacheCreate = getRemainingBudget() > FUNCTION_TIMEOUT_GUARD_MS + 3000;
            const isFirstTurn = !Array.isArray(messageHistory) || messageHistory.length === 0;
            const shouldCreateInline =
                autoCreateEnabled &&
                hasEnoughBudgetForCacheCreate &&
                isFirstTurn &&
                trimmedSystemPrompt.length >= warmupMinChars;

            if (shouldCreateInline) {
                const createdCache = await createPromptCacheEntry({
                    apiKey,
                    modelName: MODEL_NAME,
                    characterId: normalizedCharacterId,
                    systemPrompt: clampedSystemPrompt,
                    cacheKey: promptCacheKey,
                });

                if (createdCache?.name) {
                    cachedContentName = createdCache.name;
                }
            }
        }

        const isCacheLookupErrorMessage = (message) => {
            const normalized = String(message || '').toLowerCase();
            return (
                normalized.includes('cachedcontent') ||
                normalized.includes('cached content') ||
                normalized.includes('not found') ||
                normalized.includes('expired')
            );
        };

        const buildRequestPayload = ({
            requestContents,
            outputTokens,
            useCachedContent = true,
            useJsonMimeType = true,
            systemPromptText = '',
        }) => {
            const payload = {
                contents: requestContents,
                generationConfig: {
                    maxOutputTokens: outputTokens,
                    thinkingConfig: {
                        thinkingLevel: GEMINI_THINKING_LEVEL,
                    },
                },
            };

            if (useJsonMimeType) {
                payload.generationConfig.responseMimeType = 'application/json';
                payload.generationConfig.responseSchema = JSON_RESPONSE_SCHEMA;
            }

            if (useCachedContent && cachedContentName) {
                payload.cachedContent = cachedContentName;
            }

            if (systemPromptText && (!useCachedContent || !cachedContentName)) {
                payload.systemInstruction = {
                    parts: [{ text: systemPromptText }],
                };
            }

            return payload;
        };

        const callGeminiWithTimeout = async ({ modelName, payload, timeoutMs }) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: controller.signal,
                    }
                );

                let data;
                try {
                    data = await response.json();
                } catch {
                    return {
                        ok: false,
                        response,
                        data: null,
                        error: {
                            status: 502,
                            message: 'Invalid response from Gemini API.',
                            code: 'UPSTREAM_INVALID_RESPONSE',
                        },
                    };
                }

                if (!response.ok || data?.error) {
                    return {
                        ok: false,
                        response,
                        data,
                        error: {
                            status: response.status || 500,
                            message: data?.error?.message || 'Model call failed',
                            code: 'UPSTREAM_MODEL_ERROR',
                        },
                    };
                }

                return {
                    ok: true,
                    response,
                    data,
                    error: null,
                };
            } catch (fetchError) {
                if (fetchError?.name === 'AbortError') {
                    return {
                        ok: false,
                        response: null,
                        data: null,
                        error: {
                            status: 504,
                            message: `Request timeout on model ${modelName} (${timeoutMs}ms).`,
                            code: 'UPSTREAM_TIMEOUT',
                        },
                    };
                }

                return {
                    ok: false,
                    response: null,
                    data: null,
                    error: {
                        status: 503,
                        message: 'Failed to connect to Gemini API. Please try again later.',
                        code: 'UPSTREAM_CONNECTION_FAILED',
                    },
                };
            } finally {
                clearTimeout(timeoutId);
            }
        };

        let geminiResponse;
        let geminiData;
        let lastModelError = null;

        const primaryTimeoutMs = Math.min(
            MODEL_TIMEOUT_MS,
            Math.max(0, getRemainingBudget() - FUNCTION_TIMEOUT_GUARD_MS)
        );

        if (primaryTimeoutMs <= 0) {
            lastModelError = {
                status: 504,
                message: 'Function timeout budget exceeded before model response.',
                code: 'FUNCTION_BUDGET_TIMEOUT',
            };
        } else {
            let primaryResult = await callGeminiWithTimeout({
                modelName: MODEL_NAME,
                payload: buildRequestPayload({
                    requestContents: contents,
                    outputTokens: PRIMARY_MAX_OUTPUT_TOKENS,
                    systemPromptText: cachedContentName ? '' : clampedSystemPrompt,
                }),
                timeoutMs: primaryTimeoutMs,
            });

            if (
                !primaryResult.ok &&
                primaryResult.error?.code === 'UPSTREAM_MODEL_ERROR' &&
                cachedContentName &&
                cacheLookupRetryEnabled &&
                isCacheLookupErrorMessage(primaryResult.error?.message)
            ) {
                console.warn('[V-MATE] Cached content lookup failed, retrying without cache', {
                    ...logMeta,
                    errorCode: primaryResult.error?.code || null,
                    errorStatus: primaryResult.error?.status || null,
                    errorMessage: primaryResult.error?.message || null,
                    hadCachedContent: Boolean(cachedContentName),
                });
                removePromptCache(promptCacheKey);
                cachedContentName = null;

                const cacheResetRetryTimeoutMs = Math.min(
                    MODEL_TIMEOUT_MS,
                    Math.max(0, getRemainingBudget() - FUNCTION_TIMEOUT_GUARD_MS)
                );

                if (cacheResetRetryTimeoutMs > 0) {
                    primaryResult = await callGeminiWithTimeout({
                        modelName: MODEL_NAME,
                        payload: buildRequestPayload({
                            requestContents: contents,
                            outputTokens: PRIMARY_MAX_OUTPUT_TOKENS,
                            useCachedContent: false,
                            systemPromptText: clampedSystemPrompt,
                        }),
                        timeoutMs: cacheResetRetryTimeoutMs,
                    });
                }
            }

            if (primaryResult.ok) {
                geminiResponse = primaryResult.response;
                geminiData = primaryResult.data;
                lastModelError = null;
            } else {
                lastModelError = primaryResult.error;
                console.warn('[V-MATE] Primary Gemini call failed', {
                    ...logMeta,
                    errorCode: lastModelError?.code || null,
                    errorStatus: lastModelError?.status || null,
                    errorMessage: lastModelError?.message || null,
                    hadCachedContent: Boolean(cachedContentName),
                    networkRecoveryRetryEnabled,
                });

                const shouldRunRecoveryAttempt =
                    networkRecoveryRetryEnabled &&
                    (
                        lastModelError?.code === 'UPSTREAM_TIMEOUT' ||
                        lastModelError?.code === 'UPSTREAM_CONNECTION_FAILED'
                    );

                if (shouldRunRecoveryAttempt) {
                    const recoveryTimeoutMs = Math.min(
                        7000,
                        Math.max(0, getRemainingBudget() - FUNCTION_TIMEOUT_GUARD_MS)
                    );

                    if (recoveryTimeoutMs > 0) {
                        const minimalSystemPrompt = clampedSystemPrompt.slice(
                            0,
                            Math.min(MAX_SYSTEM_PROMPT_CHARS, 900)
                        );
                        const minimalContents = [
                            {
                                role: 'user',
                                parts: [{ text: clampText(userMessage) }],
                            },
                        ];

                        const recoveryResult = await callGeminiWithTimeout({
                            modelName: MODEL_NAME,
                            payload: buildRequestPayload({
                                requestContents: minimalContents,
                                outputTokens: 220,
                                useCachedContent: false,
                                systemPromptText: minimalSystemPrompt,
                            }),
                            timeoutMs: recoveryTimeoutMs,
                        });

                        if (recoveryResult.ok) {
                            geminiResponse = recoveryResult.response;
                            geminiData = recoveryResult.data;
                            lastModelError = null;
                            console.warn('[V-MATE] Gemini recovery attempt succeeded', {
                                ...logMeta,
                                recoveryTimeoutMs,
                            });
                        } else {
                            lastModelError = recoveryResult.error;
                            console.warn('[V-MATE] Gemini recovery attempt failed', {
                                ...logMeta,
                                errorCode: lastModelError?.code || null,
                                errorStatus: lastModelError?.status || null,
                                errorMessage: lastModelError?.message || null,
                                recoveryTimeoutMs,
                            });
                        }
                    }
                } else if (
                    !networkRecoveryRetryEnabled &&
                    (lastModelError?.code === 'UPSTREAM_TIMEOUT' ||
                        lastModelError?.code === 'UPSTREAM_CONNECTION_FAILED')
                ) {
                    console.warn('[V-MATE] Network recovery retry skipped by config', {
                        ...logMeta,
                        errorCode: lastModelError?.code || null,
                    });
                }
            }
        }

        if (!geminiResponse || !geminiData) {
            const upstreamErrorCode = lastModelError?.code || 'UPSTREAM_UNKNOWN_ERROR';
            const isRetryableNetworkFailure =
                upstreamErrorCode === 'UPSTREAM_CONNECTION_FAILED' ||
                upstreamErrorCode === 'UPSTREAM_TIMEOUT' ||
                upstreamErrorCode === 'FUNCTION_BUDGET_TIMEOUT';

            console.warn('[V-MATE] Returning hard error for upstream failure', {
                ...logMeta,
                upstreamErrorCode,
                elapsedMs: Math.max(0, Date.now() - requestStartedAt),
            });

            return {
                statusCode: lastModelError?.status || 503,
                headers: withElapsedHeader(headers, requestStartedAt),
                body: JSON.stringify(
                    buildErrorPayload({
                        error: lastModelError?.message || 'Model call failed. Please try again later.',
                        errorCode: upstreamErrorCode,
                        traceId: requestTraceId,
                        retryable: isRetryableNetworkFailure,
                    })
                ),
            };
        }

        if (!geminiResponse.ok || geminiData.error) {
            let errorMessage = 'Failed to get response from Gemini API';
            let errorCode = 'UPSTREAM_MODEL_ERROR';

            if (geminiData.error) {
                if (geminiData.error.message?.includes('API_KEY') || geminiData.error.message?.includes('API key')) {
                    errorMessage = 'Invalid or expired API key. Please check your GOOGLE_API_KEY in Cloudflare Worker secrets.';
                } else if (geminiData.error.message?.includes('quota') || geminiData.error.message?.includes('Quota')) {
                    errorMessage = 'API quota exceeded. Please check your Google Cloud billing.';
                } else if (
                    geminiData.error.message?.includes('location is not supported') ||
                    geminiData.error.message?.includes('User location is not supported')
                ) {
                    errorMessage = 'Gemini API is not available in this server region. Deploy backend in a supported region or switch provider.';
                    errorCode = 'UPSTREAM_LOCATION_UNSUPPORTED';
                } else {
                    errorMessage = geminiData.error.message || errorMessage;
                }
            }

            return {
                statusCode: geminiResponse.status || 500,
                headers: withElapsedHeader(headers, requestStartedAt),
                body: JSON.stringify(
                    buildErrorPayload({
                        error: errorMessage,
                        errorCode,
                        traceId: requestTraceId,
                    })
                ),
            };
        }

        let modelText = extractGeminiResponseText(geminiData);
        if (!modelText) {
            console.warn('[V-MATE] Empty Gemini response text', {
                ...logMeta,
                finishReason: geminiData?.candidates?.[0]?.finishReason || null,
                promptBlockReason: geminiData?.promptFeedback?.blockReason || null,
                emptyResponseRetryEnabled,
            });

            if (cachedContentName) {
                removePromptCache(promptCacheKey);
                cachedContentName = null;
            }

            const emptyRecoveryTimeoutMs = Math.min(
                5000,
                Math.max(0, getRemainingBudget() - FUNCTION_TIMEOUT_GUARD_MS)
            );

            if (emptyResponseRetryEnabled && emptyRecoveryTimeoutMs > 0) {
                const minimalSystemPrompt = clampedSystemPrompt.slice(
                    0,
                    Math.min(MAX_SYSTEM_PROMPT_CHARS, 700)
                );
                const emptyRecoveryContents = [{
                    role: 'user',
                    parts: [{ text: clampText(userMessage) }],
                }];

                const emptyRecoveryResult = await callGeminiWithTimeout({
                    modelName: MODEL_NAME,
                    payload: buildRequestPayload({
                        requestContents: emptyRecoveryContents,
                        outputTokens: 180,
                        useCachedContent: false,
                        useJsonMimeType: true,
                        systemPromptText: minimalSystemPrompt,
                    }),
                    timeoutMs: emptyRecoveryTimeoutMs,
                });

                if (emptyRecoveryResult.ok) {
                    const recoveredText = extractGeminiResponseText(emptyRecoveryResult.data);
                    if (recoveredText) {
                        geminiResponse = emptyRecoveryResult.response;
                        geminiData = emptyRecoveryResult.data;
                        modelText = recoveredText;
                        console.warn('[V-MATE] Empty-response recovery attempt succeeded', {
                            ...logMeta,
                            emptyRecoveryTimeoutMs,
                        });
                    } else {
                        console.warn('[V-MATE] Empty recovery response text after retry', {
                            ...logMeta,
                            finishReason: emptyRecoveryResult.data?.candidates?.[0]?.finishReason || null,
                            promptBlockReason: emptyRecoveryResult.data?.promptFeedback?.blockReason || null,
                        });
                    }
                }
            } else if (!emptyResponseRetryEnabled) {
                console.warn('[V-MATE] Empty-response recovery retry skipped by config', {
                    ...logMeta,
                });
            }
        }

        if (!modelText) {
            const finishReason = geminiData?.candidates?.[0]?.finishReason || null;
            const emptyResponseErrorCode =
                finishReason === 'MAX_TOKENS'
                    ? 'UPSTREAM_EMPTY_RESPONSE_MAX_TOKENS'
                    : 'UPSTREAM_EMPTY_RESPONSE';
            console.warn('[V-MATE] Returning hard error for empty model text', {
                ...logMeta,
                errorCode: emptyResponseErrorCode,
                finishReason,
                promptBlockReason: geminiData?.promptFeedback?.blockReason || null,
            });
            return {
                statusCode: 502,
                headers: withElapsedHeader(headers, requestStartedAt),
                body: JSON.stringify(
                    buildErrorPayload({
                        error: 'Gemini returned an empty response. Please retry.',
                        errorCode: emptyResponseErrorCode,
                        traceId: requestTraceId,
                        retryable: true,
                    })
                ),
            };
        }

        const normalizedPayload = normalizeAssistantPayload(modelText, {
            ...logMeta,
            finishReason: geminiData?.candidates?.[0]?.finishReason || null,
            promptBlockReason: geminiData?.promptFeedback?.blockReason || null,
        });
        const isFormatFallback =
            normalizedPayload.response === '잠시 응답 형식이 불안정했어요. 한 번만 다시 말해줘.' &&
            normalizedPayload.inner_heart === '';
        if (isFormatFallback) {
            console.warn('[V-MATE] Returning hard error for format fallback payload', {
                ...logMeta,
                rawModelTextPreview: toSafeLogPreview(modelText),
            });
            if (cachedContentName) {
                removePromptCache(promptCacheKey);
                cachedContentName = null;
            }
            return {
                statusCode: 502,
                headers: withElapsedHeader(headers, requestStartedAt),
                body: JSON.stringify(
                    buildErrorPayload({
                        error: 'Gemini response format validation failed.',
                        errorCode: 'UPSTREAM_INVALID_FORMAT',
                        traceId: requestTraceId,
                    })
                ),
            };
        }
        const finalPayload = normalizedPayload;
        const responseCachedContent = cachedContentName || null;

        if (canUseContextCache && promptCacheKey && responseCachedContent) {
            const { ttlSeconds } = getGeminiContextCacheConfig();
            promptCacheStore.set(promptCacheKey, {
                name: responseCachedContent,
                expireAtMs: Date.now() + Math.max(300, ttlSeconds) * 1000,
            });
        }

        return {
            statusCode: 200,
            headers: withElapsedHeader(headers, requestStartedAt),
            body: JSON.stringify({
                text: JSON.stringify(finalPayload),
                cachedContent: responseCachedContent,
                trace_id: requestTraceId,
            }),
        };
    } catch (error) {
        console.error('[V-MATE] Unexpected error:', error?.message || error);

        return {
            statusCode: 500,
            headers: withElapsedHeader(headers, requestStartedAt),
            body: JSON.stringify(
                buildErrorPayload({
                    error: 'Internal server error. Please try again later.',
                    errorCode: 'INTERNAL_SERVER_ERROR',
                    traceId: requestTraceId,
                    details: process.env.CLOUDFLARE_DEV ? error.message : undefined,
                })
            ),
        };
    }
};
