import { createRuntimeEnvironment, readRuntimeEnvironmentString } from './runtime-environment.js';

const defaultEnvironment = () => (
    typeof process !== 'undefined' && process.env ? process.env : {}
);

const read = (environment, key) => readRuntimeEnvironmentString(environment, key);

const toSafeInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    if (parsed < min) {
        return min;
    }

    if (parsed > max) {
        return max;
    }

    return parsed;
};

const parseStoreMode = (value) => {
    const normalized = String(value || 'memory').trim().toLowerCase();
    return normalized === 'kv' ? 'kv' : 'memory';
};

const firstNonEmpty = (values) => {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) {
            return normalized;
        }
    }
    return '';
};

const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

export const getRequestBodyLimitBytes = (environment = defaultEnvironment()) =>
    toSafeInt(read(environment, 'REQUEST_BODY_MAX_BYTES'), 32 * 1024, {
        min: 1024,
        max: 1_048_576,
    });

export const shouldUseGeminiContextCache = (environment = defaultEnvironment()) =>
    String(read(environment, 'GEMINI_CONTEXT_CACHE_ENABLED') || 'true').toLowerCase() !== 'false';

export const getGeminiContextCacheConfig = (environment = defaultEnvironment()) => ({
    ttlSeconds: toSafeInt(read(environment, 'GEMINI_CONTEXT_CACHE_TTL_SECONDS'), 21600, {
        min: 300,
        max: 86400,
    }),
    createTimeoutMs: toSafeInt(read(environment, 'GEMINI_CONTEXT_CACHE_CREATE_TIMEOUT_MS'), 1800, {
        min: 300,
        max: 10000,
    }),
    warmupMinChars: toSafeInt(read(environment, 'GEMINI_CONTEXT_CACHE_WARMUP_MIN_CHARS'), 1200, {
        min: 200,
        max: 12000,
    }),
    autoCreateEnabled: String(read(environment, 'GEMINI_CONTEXT_CACHE_AUTO_CREATE') || 'false').toLowerCase() !== 'false',
});

export const getGeminiRetryConfig = (environment = defaultEnvironment()) => ({
    cacheLookupRetryEnabled:
        String(read(environment, 'GEMINI_CACHE_LOOKUP_RETRY_ENABLED') || 'true').toLowerCase() !== 'false',
    networkRecoveryRetryEnabled:
        String(read(environment, 'GEMINI_NETWORK_RECOVERY_RETRY_ENABLED') || 'true').toLowerCase() !== 'false',
    emptyResponseRetryEnabled:
        String(read(environment, 'GEMINI_EMPTY_RESPONSE_RETRY_ENABLED') || 'true').toLowerCase() !== 'false',
});

export const getGeminiThinkingLevel = (environment = defaultEnvironment()) => {
    const raw = String(read(environment, 'GEMINI_THINKING_LEVEL') || 'minimal').trim().toLowerCase();
    const allowed = new Set(['minimal', 'low', 'medium', 'high']);
    return allowed.has(raw) ? raw : 'minimal';
};

export const shouldAllowAllOrigins = (environment = defaultEnvironment()) => {
    return String(read(environment, 'ALLOW_ALL_ORIGINS') || 'false').toLowerCase() === 'true';
};

export const shouldAllowRequestsWithoutOrigin = (environment = defaultEnvironment()) => {
    return String(read(environment, 'ALLOW_NON_BROWSER_ORIGIN') || 'false').toLowerCase() === 'true';
};

export const shouldTrustForwardedFor = (environment = defaultEnvironment()) =>
    String(read(environment, 'TRUST_X_FORWARDED_FOR') || 'false').toLowerCase() === 'true';

export const shouldTrustProxyHeaders = (environment = defaultEnvironment()) =>
    String(read(environment, 'TRUST_PROXY_HEADERS') || 'false').toLowerCase() === 'true';

export const shouldRequireJsonContentType = (environment = defaultEnvironment()) =>
    String(read(environment, 'REQUIRE_JSON_CONTENT_TYPE') || 'false').toLowerCase() === 'true';

export const getRateLimitConfig = (environment = defaultEnvironment()) => {
    return {
        windowMs: toSafeInt(read(environment, 'RATE_LIMIT_WINDOW_MS'), 60000, {
            min: 1000,
            max: 3_600_000,
        }),
        maxRequests: toSafeInt(read(environment, 'RATE_LIMIT_MAX_REQUESTS'), 30, {
            min: 1,
            max: 10_000,
        }),
    };
};

export const getDailyChatLimit = (environment = defaultEnvironment()) =>
    toSafeInt(read(environment, 'CHAT_DAILY_MESSAGE_LIMIT'), 30, {
        min: 1,
        max: 500,
    });

export const getRateLimitMaxKeys = (environment = defaultEnvironment()) =>
    toSafeInt(read(environment, 'RATE_LIMIT_MAX_KEYS'), 5000, {
        min: 1,
        max: 200_000,
    });

export const getPromptCacheMaxEntries = (environment = defaultEnvironment()) =>
    toSafeInt(read(environment, 'PROMPT_CACHE_MAX_ENTRIES'), 256, {
        min: 1,
        max: 4096,
    });

export const getClientRequestDedupeConfig = (environment = defaultEnvironment()) => ({
    windowMs: toSafeInt(read(environment, 'CLIENT_REQUEST_DEDUPE_WINDOW_MS'), 15000, {
        min: 0,
        max: 120000,
    }),
    maxEntries: toSafeInt(read(environment, 'CLIENT_REQUEST_DEDUPE_MAX_ENTRIES'), 2000, {
        min: 100,
        max: 20000,
    }),
});

export const getRateLimitStoreMode = (environment = defaultEnvironment()) => parseStoreMode(read(environment, 'RATE_LIMIT_STORE'));

export const getPromptCacheStoreMode = (environment = defaultEnvironment()) => parseStoreMode(read(environment, 'PROMPT_CACHE_STORE'));

export const getChatAuthConfig = (environment = defaultEnvironment()) => ({
    requireAuth: String(read(environment, 'REQUIRE_AUTH_FOR_CHAT') || 'true').toLowerCase() !== 'false',
    authProviderTimeoutMs: toSafeInt(read(environment, 'AUTH_PROVIDER_TIMEOUT_MS'), 3500, {
        min: 500,
        max: 10000,
    }),
    authProviderRetryCount: toSafeInt(read(environment, 'AUTH_PROVIDER_RETRY_COUNT'), 1, {
        min: 0,
        max: 2,
    }),
    supabaseUrl: normalizeUrl(firstNonEmpty([
        read(environment, 'SUPABASE_URL'),
        read(environment, 'VITE_SUPABASE_URL'),
        read(environment, 'VITE_PUBLIC_SUPABASE_URL'),
    ])),
    supabaseAnonKey: firstNonEmpty([
        read(environment, 'SUPABASE_ANON_KEY'),
        read(environment, 'SUPABASE_PUBLISHABLE_KEY'),
        read(environment, 'VITE_SUPABASE_ANON_KEY'),
        read(environment, 'VITE_SUPABASE_PUBLISHABLE_KEY'),
        read(environment, 'VITE_PUBLIC_SUPABASE_ANON_KEY'),
        read(environment, 'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    ]),
});

export const getChatRuntimeLimits = (environment = defaultEnvironment()) => {
    const functionTotalTimeoutMs = toSafeInt(read(environment, 'FUNCTION_TOTAL_TIMEOUT_MS'), 20000, {
        min: 2000,
        max: 120000,
    });
    const functionTimeoutGuardMs = toSafeInt(read(environment, 'FUNCTION_TIMEOUT_GUARD_MS'), 1500, {
        min: 100,
        max: 10000,
    });

    return {
        maxHistoryMessages: toSafeInt(read(environment, 'GEMINI_HISTORY_MESSAGES'), 12, {
            min: 1,
            max: 100,
        }),
        maxPartChars: toSafeInt(read(environment, 'GEMINI_MAX_PART_CHARS'), 700, {
            min: 100,
            max: 4000,
        }),
        maxSystemPromptChars: toSafeInt(read(environment, 'GEMINI_MAX_SYSTEM_PROMPT_CHARS'), 5000, {
            min: 500,
            max: 12000,
        }),
        primaryMaxOutputTokens: toSafeInt(read(environment, 'GEMINI_MAX_OUTPUT_TOKENS'), 2048, {
            min: 64,
            max: 8192,
        }),
        modelTimeoutMs: toSafeInt(read(environment, 'GEMINI_MODEL_TIMEOUT_MS'), 15000, {
            min: 1000,
            max: 60000,
        }),
        functionTotalTimeoutMs,
        functionTimeoutGuardMs: Math.min(functionTimeoutGuardMs, Math.max(100, functionTotalTimeoutMs - 100)),
    };
};

const freezeRecord = (value) => Object.freeze({ ...value });

/**
 * Resolve one immutable configuration snapshot for an adapter invocation.
 * Existing getter exports continue to read process.env by default for direct
 * Node/module callers, while adapters can inject this object explicitly.
 */
export const createRuntimeConfig = (source = defaultEnvironment()) => {
    const environment = createRuntimeEnvironment(source);
    const allowedOriginsRaw = read(environment, 'ALLOWED_ORIGINS').trim();
    const allowedOrigins = allowedOriginsRaw
        ? allowedOriginsRaw
            .split(',')
            .map((origin) => normalizeUrl(origin))
            .filter(Boolean)
        : [
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'http://localhost:8888',
            'http://127.0.0.1:8888',
        ];

    return Object.freeze({
        environment,
        requestBodyLimitBytes: getRequestBodyLimitBytes(environment),
        cors: Object.freeze({
            allowAllOrigins: shouldAllowAllOrigins(environment),
            allowRequestsWithoutOrigin: shouldAllowRequestsWithoutOrigin(environment),
            allowedOrigins: Object.freeze(allowedOrigins),
        }),
        rateLimit: freezeRecord(getRateLimitConfig(environment)),
        rateLimitMaxKeys: getRateLimitMaxKeys(environment),
        rateLimitStoreMode: getRateLimitStoreMode(environment),
        promptCacheMaxEntries: getPromptCacheMaxEntries(environment),
        promptCacheStoreMode: getPromptCacheStoreMode(environment),
        clientRequestDedupe: freezeRecord(getClientRequestDedupeConfig(environment)),
        chatAuth: freezeRecord(getChatAuthConfig(environment)),
        chatRuntimeLimits: freezeRecord(getChatRuntimeLimits(environment)),
        geminiContextCache: freezeRecord({
            ...getGeminiContextCacheConfig(environment),
            enabled: shouldUseGeminiContextCache(environment),
        }),
        geminiRetry: freezeRecord(getGeminiRetryConfig(environment)),
        geminiThinkingLevel: getGeminiThinkingLevel(environment),
        dailyChatLimit: getDailyChatLimit(environment),
        requireJsonContentType: shouldRequireJsonContentType(environment),
        trustProxyHeaders: shouldTrustProxyHeaders(environment),
        trustForwardedFor: shouldTrustForwardedFor(environment),
    });
};
