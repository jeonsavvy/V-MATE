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

export const getRequestBodyLimitBytes = () =>
    toSafeInt(process.env.REQUEST_BODY_MAX_BYTES, 32 * 1024, {
        min: 1024,
        max: 1_048_576,
    });

export const shouldUseGeminiContextCache = () =>
    String(process.env.GEMINI_CONTEXT_CACHE_ENABLED || 'true').toLowerCase() !== 'false';

export const getGeminiContextCacheConfig = () => ({
    ttlSeconds: toSafeInt(process.env.GEMINI_CONTEXT_CACHE_TTL_SECONDS, 21600, {
        min: 300,
        max: 86400,
    }),
    createTimeoutMs: toSafeInt(process.env.GEMINI_CONTEXT_CACHE_CREATE_TIMEOUT_MS, 1800, {
        min: 300,
        max: 10000,
    }),
    warmupMinChars: toSafeInt(process.env.GEMINI_CONTEXT_CACHE_WARMUP_MIN_CHARS, 1200, {
        min: 200,
        max: 12000,
    }),
    autoCreateEnabled: String(process.env.GEMINI_CONTEXT_CACHE_AUTO_CREATE || 'false').toLowerCase() !== 'false',
});

export const getGeminiRetryConfig = () => ({
    cacheLookupRetryEnabled:
        String(process.env.GEMINI_CACHE_LOOKUP_RETRY_ENABLED || 'true').toLowerCase() !== 'false',
    networkRecoveryRetryEnabled:
        String(process.env.GEMINI_NETWORK_RECOVERY_RETRY_ENABLED || 'true').toLowerCase() !== 'false',
    emptyResponseRetryEnabled:
        String(process.env.GEMINI_EMPTY_RESPONSE_RETRY_ENABLED || 'false').toLowerCase() === 'true',
});

export const getGeminiThinkingLevel = () => {
    const raw = String(process.env.GEMINI_THINKING_LEVEL || 'minimal').trim().toLowerCase();
    const allowed = new Set(['minimal', 'low', 'medium', 'high']);
    return allowed.has(raw) ? raw : 'minimal';
};

export const shouldAllowAllOrigins = () => {
    return String(process.env.ALLOW_ALL_ORIGINS || 'false').toLowerCase() === 'true';
};

export const shouldAllowRequestsWithoutOrigin = () => {
    return String(process.env.ALLOW_NON_BROWSER_ORIGIN || 'false').toLowerCase() === 'true';
};

export const shouldTrustForwardedFor = () =>
    String(process.env.TRUST_X_FORWARDED_FOR || 'false').toLowerCase() === 'true';

export const shouldTrustProxyHeaders = () =>
    String(process.env.TRUST_PROXY_HEADERS || 'false').toLowerCase() === 'true';

export const shouldRequireJsonContentType = () =>
    String(process.env.REQUIRE_JSON_CONTENT_TYPE || 'false').toLowerCase() === 'true';

export const getRateLimitConfig = () => {
    return {
        windowMs: toSafeInt(process.env.RATE_LIMIT_WINDOW_MS, 60000, {
            min: 1000,
            max: 3_600_000,
        }),
        maxRequests: toSafeInt(process.env.RATE_LIMIT_MAX_REQUESTS, 30, {
            min: 1,
            max: 10_000,
        }),
    };
};

export const getRateLimitMaxKeys = () =>
    toSafeInt(process.env.RATE_LIMIT_MAX_KEYS, 5000, {
        min: 1,
        max: 200_000,
    });

export const getPromptCacheMaxEntries = () =>
    toSafeInt(process.env.PROMPT_CACHE_MAX_ENTRIES, 256, {
        min: 1,
        max: 4096,
    });

export const getClientRequestDedupeConfig = () => ({
    windowMs: toSafeInt(process.env.CLIENT_REQUEST_DEDUPE_WINDOW_MS, 15000, {
        min: 0,
        max: 120000,
    }),
    maxEntries: toSafeInt(process.env.CLIENT_REQUEST_DEDUPE_MAX_ENTRIES, 2000, {
        min: 100,
        max: 20000,
    }),
});

export const getRateLimitStoreMode = () => parseStoreMode(process.env.RATE_LIMIT_STORE);

export const getPromptCacheStoreMode = () => parseStoreMode(process.env.PROMPT_CACHE_STORE);

export const getChatAuthConfig = () => ({
    requireAuth: String(process.env.REQUIRE_AUTH_FOR_CHAT || 'true').toLowerCase() !== 'false',
    authProviderTimeoutMs: toSafeInt(process.env.AUTH_PROVIDER_TIMEOUT_MS, 3500, {
        min: 500,
        max: 10000,
    }),
    authProviderRetryCount: toSafeInt(process.env.AUTH_PROVIDER_RETRY_COUNT, 1, {
        min: 0,
        max: 2,
    }),
    supabaseUrl: normalizeUrl(firstNonEmpty([
        process.env.SUPABASE_URL,
        process.env.VITE_SUPABASE_URL,
        process.env.VITE_PUBLIC_SUPABASE_URL,
    ])),
    supabaseAnonKey: firstNonEmpty([
        process.env.SUPABASE_ANON_KEY,
        process.env.SUPABASE_PUBLISHABLE_KEY,
        process.env.VITE_SUPABASE_ANON_KEY,
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        process.env.VITE_PUBLIC_SUPABASE_ANON_KEY,
        process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ]),
});

export const getChatRuntimeLimits = () => {
    const functionTotalTimeoutMs = toSafeInt(process.env.FUNCTION_TOTAL_TIMEOUT_MS, 20000, {
        min: 2000,
        max: 120000,
    });
    const functionTimeoutGuardMs = toSafeInt(process.env.FUNCTION_TIMEOUT_GUARD_MS, 1500, {
        min: 100,
        max: 10000,
    });

    return {
        maxHistoryMessages: toSafeInt(process.env.GEMINI_HISTORY_MESSAGES, 10, {
            min: 1,
            max: 100,
        }),
        maxPartChars: toSafeInt(process.env.GEMINI_MAX_PART_CHARS, 700, {
            min: 100,
            max: 4000,
        }),
        maxSystemPromptChars: toSafeInt(process.env.GEMINI_MAX_SYSTEM_PROMPT_CHARS, 5000, {
            min: 500,
            max: 12000,
        }),
        primaryMaxOutputTokens: toSafeInt(process.env.GEMINI_MAX_OUTPUT_TOKENS, 1024, {
            min: 64,
            max: 8192,
        }),
        modelTimeoutMs: toSafeInt(process.env.GEMINI_MODEL_TIMEOUT_MS, 15000, {
            min: 1000,
            max: 60000,
        }),
        functionTotalTimeoutMs,
        functionTimeoutGuardMs: Math.min(functionTimeoutGuardMs, Math.max(100, functionTotalTimeoutMs - 100)),
    };
};
