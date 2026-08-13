const DEPRECATED_RUNTIME_ENV_ALIASES = Object.freeze({
    VITE_SUPABASE_ANON_KEY: Object.freeze([' VITE_SUPABASE_ANON_KEY']),
});

const RUNTIME_ENVIRONMENT_KEYS = Object.freeze([
    'ALLOW_ALL_ORIGINS',
    'ALLOW_NON_BROWSER_ORIGIN',
    'ALLOWED_ORIGINS',
    'APP_ENV',
    'AUTH_PROVIDER_RETRY_COUNT',
    'AUTH_PROVIDER_TIMEOUT_MS',
    'CHAT_DAILY_MESSAGE_LIMIT',
    'CLIENT_REQUEST_DEDUPE_MAX_ENTRIES',
    'CLIENT_REQUEST_DEDUPE_WINDOW_MS',
    'FUNCTION_TIMEOUT_GUARD_MS',
    'FUNCTION_TOTAL_TIMEOUT_MS',
    'GEMINI_CACHE_LOOKUP_RETRY_ENABLED',
    'GEMINI_CONTEXT_CACHE_AUTO_CREATE',
    'GEMINI_CONTEXT_CACHE_CREATE_TIMEOUT_MS',
    'GEMINI_CONTEXT_CACHE_ENABLED',
    'GEMINI_CONTEXT_CACHE_TTL_SECONDS',
    'GEMINI_CONTEXT_CACHE_WARMUP_MIN_CHARS',
    'GEMINI_EMPTY_RESPONSE_RETRY_ENABLED',
    'GEMINI_HISTORY_MESSAGES',
    'GEMINI_MAX_OUTPUT_TOKENS',
    'GEMINI_MAX_PART_CHARS',
    'GEMINI_MAX_SYSTEM_PROMPT_CHARS',
    'GEMINI_MODEL_TIMEOUT_MS',
    'GEMINI_NETWORK_RECOVERY_RETRY_ENABLED',
    'GEMINI_THINKING_LEVEL',
    'GOOGLE_API_KEY',
    'LOG_LEVEL',
    'NODE_ENV',
    'PROMPT_CACHE_KV',
    'PROMPT_CACHE_KV_PREFIX',
    'PROMPT_CACHE_MAX_ENTRIES',
    'PROMPT_CACHE_STORE',
    'PUBLIC_ASSETS_BUCKET',
    'RATE_LIMIT_KV',
    'RATE_LIMIT_KV_PREFIX',
    'RATE_LIMIT_MAX_KEYS',
    'RATE_LIMIT_MAX_REQUESTS',
    'RATE_LIMIT_STORE',
    'RATE_LIMIT_WINDOW_MS',
    'REQUEST_BODY_MAX_BYTES',
    'REQUIRE_AUTH_FOR_CHAT',
    'REQUIRE_CONFIGURED_SUPABASE_URL',
    'REQUIRE_JSON_CONTENT_TYPE',
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_URL',
    'TRUST_PROXY_HEADERS',
    'TRUST_X_FORWARDED_FOR',
    'VITE_PUBLIC_SUPABASE_ANON_KEY',
    'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'VITE_PUBLIC_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_URL',
    'V_MATE_LOG_LEVEL',
    'V_MATE_PROMPT_CACHE_KV',
    'V_MATE_RATE_LIMIT_KV',
]);

const isObjectLike = (value) => value !== null && (typeof value === 'object' || typeof value === 'function');

/**
 * Capture runtime bindings without mutating process.env.
 *
 * The returned object is a shallow immutable snapshot: binding objects such as
 * Cloudflare KV namespaces retain their native identity while callers cannot
 * replace top-level configuration during a request.
 */
export const createRuntimeEnvironment = (...sources) => {
    const environment = {};

    for (const source of sources) {
        if (!isObjectLike(source)) {
            continue;
        }

        for (const key of RUNTIME_ENVIRONMENT_KEYS) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                environment[key] = source[key];
            }
        }

        for (const aliases of Object.values(DEPRECATED_RUNTIME_ENV_ALIASES)) {
            for (const alias of aliases) {
                if (Object.prototype.hasOwnProperty.call(source, alias)) {
                    environment[alias] = source[alias];
                }
            }
        }
    }

    return Object.freeze(environment);
};

/**
 * Read only an exact binding name, plus a deliberately enumerated legacy typo.
 * This prevents unrelated whitespace-padded bindings from silently becoming
 * trusted configuration while preserving the one historical public alias.
 */
export const readRuntimeEnvironmentString = (environment, key) => {
    const directValue = environment?.[key];
    if (typeof directValue === 'string') {
        return directValue;
    }

    const aliases = DEPRECATED_RUNTIME_ENV_ALIASES[key] || [];
    for (const alias of aliases) {
        const aliasValue = environment?.[alias];
        if (typeof aliasValue === 'string') {
            return aliasValue;
        }
    }

    return '';
};
