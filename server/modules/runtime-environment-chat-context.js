import {
    createKvPromptCacheAdapter,
    createKvRateLimitHook,
} from './runtime-chat-context.js';
import { logServerWarn } from './server-logger.js';

const RATE_LIMIT_KV_BINDING_KEYS = Object.freeze(['V_MATE_RATE_LIMIT_KV', 'RATE_LIMIT_KV']);
const PROMPT_CACHE_KV_BINDING_KEYS = Object.freeze(['V_MATE_PROMPT_CACHE_KV', 'PROMPT_CACHE_KV']);
const DEFAULT_RATE_LIMIT_KV_PREFIX = 'v-mate:rl:';
const DEFAULT_PROMPT_CACHE_KV_PREFIX = 'v-mate:pc:';

const isKvNamespace = (value) => Boolean(value)
    && typeof value.get === 'function'
    && typeof value.put === 'function'
    && typeof value.delete === 'function';

const resolveKvBinding = (environment, bindingKeys) => {
    for (const key of bindingKeys) {
        const candidate = environment?.[key];
        if (isKvNamespace(candidate)) {
            return candidate;
        }
    }
    return null;
};

const toSafePrefix = (value, fallback) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return fallback;
    }
    return normalized.endsWith(':') ? normalized : `${normalized}:`;
};

/** Build request-safe chat hooks directly from an immutable runtime config. */
export const resolveRuntimeEnvironmentChatContext = ({ runtimeConfig, traceId = null } = {}) => {
    const environment = runtimeConfig?.environment;
    if (!environment) {
        return {};
    }

    const context = {};
    if (runtimeConfig.rateLimitStoreMode === 'kv') {
        const rateLimitKv = resolveKvBinding(environment, RATE_LIMIT_KV_BINDING_KEYS);
        if (rateLimitKv) {
            context.checkRateLimit = createKvRateLimitHook({
                kv: rateLimitKv,
                windowMs: runtimeConfig.rateLimit.windowMs,
                prefix: toSafePrefix(environment.RATE_LIMIT_KV_PREFIX, DEFAULT_RATE_LIMIT_KV_PREFIX),
            });
        } else {
            logServerWarn('[V-MATE] Configured rate-limit store is unavailable', {
                traceId,
                hasRequiredBinding: false,
            });
        }
    }

    if (runtimeConfig.promptCacheStoreMode === 'kv') {
        const promptCacheKv = resolveKvBinding(environment, PROMPT_CACHE_KV_BINDING_KEYS);
        if (promptCacheKv) {
            context.promptCache = createKvPromptCacheAdapter({
                kv: promptCacheKv,
                prefix: toSafePrefix(environment.PROMPT_CACHE_KV_PREFIX, DEFAULT_PROMPT_CACHE_KV_PREFIX),
            });
        } else {
            logServerWarn('[V-MATE] Configured prompt-cache store is unavailable', {
                traceId,
                hasRequiredBinding: false,
            });
        }
    }

    return context;
};
