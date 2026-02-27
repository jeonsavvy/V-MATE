import { createHash } from 'node:crypto';
import { isValidCachedContentName } from './prompt-cache.js';
import {
    getPromptCacheStoreMode,
    getRateLimitConfig,
    getRateLimitStoreMode,
} from './runtime-config.js';
import { logServerWarn } from './server-logger.js';

const RATE_LIMIT_KV_BINDING_KEYS = ['V_MATE_RATE_LIMIT_KV', 'RATE_LIMIT_KV'];
const PROMPT_CACHE_KV_BINDING_KEYS = ['V_MATE_PROMPT_CACHE_KV', 'PROMPT_CACHE_KV'];
const DEFAULT_RATE_LIMIT_KV_PREFIX = 'v-mate:rl:';
const DEFAULT_PROMPT_CACHE_KV_PREFIX = 'v-mate:pc:';
const EXPIRY_BUFFER_MS = 15_000;

let runtimeContextCache = new WeakMap();

const isKvNamespace = (value) =>
    Boolean(value) &&
    typeof value.get === 'function' &&
    typeof value.put === 'function' &&
    typeof value.delete === 'function';

const resolveKvBinding = (env, bindingKeys) => {
    for (const key of bindingKeys) {
        const candidate = env?.[key];
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

const parseSerializedObject = (value) => {
    if (!value) {
        return null;
    }

    if (typeof value === 'object') {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const toHashedStoreKey = (prefix, key) =>
    `${prefix}${createHash('sha256').update(String(key || '')).digest('hex')}`;

const toExpirationTtlSeconds = (remainingMs, fallbackSeconds = 120) => {
    if (!Number.isFinite(remainingMs)) {
        return fallbackSeconds;
    }

    return Math.max(60, Math.ceil(remainingMs / 1000) + 30);
};

const parseRateLimitEntry = (value) => {
    const parsed = parseSerializedObject(value);
    if (!parsed) {
        return null;
    }

    const count = Number(parsed.count);
    const resetAt = Number(parsed.resetAt);
    if (!Number.isFinite(count) || count < 0 || !Number.isFinite(resetAt) || resetAt <= 0) {
        return null;
    }

    return {
        count: Math.floor(count),
        resetAt: Math.floor(resetAt),
    };
};

const parsePromptCacheEntry = (value) => {
    const parsed = parseSerializedObject(value);
    if (!parsed) {
        return null;
    }

    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const expireAtMs = Number(parsed.expireAtMs);
    if (!isValidCachedContentName(name) || !Number.isFinite(expireAtMs) || expireAtMs <= 0) {
        return null;
    }

    return {
        name,
        expireAtMs: Math.floor(expireAtMs),
    };
};

export const createKvRateLimitHook = ({
    kv,
    windowMs,
    prefix = DEFAULT_RATE_LIMIT_KV_PREFIX,
    now = () => Date.now(),
}) => async ({ key, defaultLimit }) => {
    const { maxRequests, windowMs: defaultWindowMs } = getRateLimitConfig();
    const resolvedWindowMs = Number.isFinite(Number(windowMs)) && Number(windowMs) > 0
        ? Math.floor(Number(windowMs))
        : defaultWindowMs;
    const resolvedLimit = Number.isFinite(Number(defaultLimit)) && Number(defaultLimit) > 0
        ? Math.floor(Number(defaultLimit))
        : maxRequests;
    const nowMs = now();

    const storeKey = toHashedStoreKey(prefix, key);
    const existing = parseRateLimitEntry(await kv.get(storeKey));

    if (existing && nowMs <= existing.resetAt) {
        const retryAfterMs = Math.max(0, existing.resetAt - nowMs);
        if (existing.count >= resolvedLimit) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs,
                limit: resolvedLimit,
            };
        }

        const updated = {
            count: existing.count + 1,
            resetAt: existing.resetAt,
        };
        await kv.put(storeKey, JSON.stringify(updated), {
            expirationTtl: toExpirationTtlSeconds(retryAfterMs),
        });

        return {
            allowed: true,
            remaining: Math.max(0, resolvedLimit - updated.count),
            retryAfterMs,
            limit: resolvedLimit,
        };
    }

    const next = {
        count: 1,
        resetAt: nowMs + resolvedWindowMs,
    };
    await kv.put(storeKey, JSON.stringify(next), {
        expirationTtl: toExpirationTtlSeconds(resolvedWindowMs),
    });

    return {
        allowed: true,
        remaining: Math.max(0, resolvedLimit - 1),
        retryAfterMs: resolvedWindowMs,
        limit: resolvedLimit,
    };
};

export const createKvPromptCacheAdapter = ({
    kv,
    prefix = DEFAULT_PROMPT_CACHE_KV_PREFIX,
    now = () => Date.now(),
}) => ({
    async get(key) {
        const storeKey = toHashedStoreKey(prefix, key);
        const entry = parsePromptCacheEntry(await kv.get(storeKey));
        if (!entry) {
            return null;
        }

        const nowMs = now();
        if (nowMs >= entry.expireAtMs - EXPIRY_BUFFER_MS) {
            await kv.delete(storeKey);
            return null;
        }

        return entry;
    },

    async set(key, entry) {
        const storeKey = toHashedStoreKey(prefix, key);
        const normalizedEntry = parsePromptCacheEntry(entry);
        if (!normalizedEntry) {
            return;
        }

        const nowMs = now();
        const remainingMs = normalizedEntry.expireAtMs - nowMs;
        if (remainingMs <= EXPIRY_BUFFER_MS) {
            await kv.delete(storeKey);
            return;
        }

        await kv.put(storeKey, JSON.stringify(normalizedEntry), {
            expirationTtl: toExpirationTtlSeconds(remainingMs),
        });
    },

    async remove(key) {
        const storeKey = toHashedStoreKey(prefix, key);
        await kv.delete(storeKey);
    },
});

export const resolveRuntimeChatHandlerContext = ({ env, traceId = null } = {}) => {
    if (!env || typeof env !== 'object') {
        return {};
    }

    const cached = runtimeContextCache.get(env);
    if (cached) {
        return cached;
    }

    const context = {};
    const { windowMs } = getRateLimitConfig();

    if (getRateLimitStoreMode() === 'kv') {
        const rateLimitKv = resolveKvBinding(env, RATE_LIMIT_KV_BINDING_KEYS);
        if (rateLimitKv) {
            context.checkRateLimit = createKvRateLimitHook({
                kv: rateLimitKv,
                windowMs,
                prefix: toSafePrefix(env.RATE_LIMIT_KV_PREFIX, DEFAULT_RATE_LIMIT_KV_PREFIX),
            });
        } else {
            logServerWarn('[V-MATE] RATE_LIMIT_STORE=kv enabled but no KV binding was provided', {
                traceId,
                bindingKeys: RATE_LIMIT_KV_BINDING_KEYS.join(','),
            });
        }
    }

    if (getPromptCacheStoreMode() === 'kv') {
        const promptCacheKv = resolveKvBinding(env, PROMPT_CACHE_KV_BINDING_KEYS);
        if (promptCacheKv) {
            context.promptCache = createKvPromptCacheAdapter({
                kv: promptCacheKv,
                prefix: toSafePrefix(env.PROMPT_CACHE_KV_PREFIX, DEFAULT_PROMPT_CACHE_KV_PREFIX),
            });
        } else {
            logServerWarn('[V-MATE] PROMPT_CACHE_STORE=kv enabled but no KV binding was provided', {
                traceId,
                bindingKeys: PROMPT_CACHE_KV_BINDING_KEYS.join(','),
            });
        }
    }

    runtimeContextCache.set(env, context);
    return context;
};

export const resetRuntimeChatContextCacheForTests = () => {
    runtimeContextCache = new WeakMap();
};
