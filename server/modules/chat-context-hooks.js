import { removePromptCache, setPromptCacheEntry } from './prompt-cache.js';
import { logServerWarn } from './server-logger.js';

const toSafeRateLimitNumber = (value, fallback, { min = 0 } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.floor(parsed));
};

export const resolveRateLimitState = async ({
    context,
    event,
    origin,
    rateKey,
    defaultLimit,
    getDefaultStatus,
    traceId = null,
}) => {
    let resolvedDefaultStatus = null;
    const ensureDefaultStatus = async () => {
        if (resolvedDefaultStatus) {
            return resolvedDefaultStatus;
        }

        if (typeof getDefaultStatus === 'function') {
            const maybeStatus = await getDefaultStatus();
            if (maybeStatus && typeof maybeStatus === 'object') {
                resolvedDefaultStatus = maybeStatus;
                return resolvedDefaultStatus;
            }
        }

        resolvedDefaultStatus = {
            allowed: true,
            remaining: Math.max(0, defaultLimit),
            retryAfterMs: 0,
        };
        return resolvedDefaultStatus;
    };

    if (typeof context?.checkRateLimit !== 'function') {
        const defaultStatus = await ensureDefaultStatus();
        return {
            status: defaultStatus,
            limit: defaultLimit,
        };
    }

    try {
        const customStatus = await context.checkRateLimit({
            key: rateKey,
            origin,
            event,
            defaultLimit,
        });

        if (!customStatus || typeof customStatus !== 'object' || typeof customStatus.allowed !== 'boolean') {
            const defaultStatus = await ensureDefaultStatus();
            return {
                status: defaultStatus,
                limit: defaultLimit,
            };
        }
        const hasRemaining = Number.isFinite(Number(customStatus.remaining));
        const hasRetryAfterMs = Number.isFinite(Number(customStatus.retryAfterMs));
        const fallbackStatus = hasRemaining && hasRetryAfterMs
            ? null
            : await ensureDefaultStatus();

        return {
            status: {
                allowed: customStatus.allowed,
                remaining: toSafeRateLimitNumber(customStatus.remaining, fallbackStatus?.remaining ?? 0, { min: 0 }),
                retryAfterMs: toSafeRateLimitNumber(customStatus.retryAfterMs, fallbackStatus?.retryAfterMs ?? 0, { min: 0 }),
            },
            limit: toSafeRateLimitNumber(customStatus.limit, defaultLimit, { min: 1 }),
        };
    } catch (error) {
        logServerWarn('[V-MATE] Custom rate-limit hook failed, using default limiter', {
            traceId,
            message: error?.message || String(error),
        });
        const defaultStatus = await ensureDefaultStatus();
        return {
            status: defaultStatus,
            limit: defaultLimit,
        };
    }
};

export const resolvePromptCacheAdapter = (context) => {
    const adapter = context?.promptCache;
    if (!adapter || typeof adapter !== 'object') {
        return null;
    }

    const hasSupportedMethod = ['get', 'set', 'remove'].some((methodName) => typeof adapter[methodName] === 'function');
    return hasSupportedMethod ? adapter : null;
};

export const setPromptCacheWithAdapter = async ({
    promptCacheAdapter,
    promptCacheKey,
    entry,
    traceId,
    characterId,
}) => {
    if (!promptCacheKey || !entry?.name) {
        return;
    }

    setPromptCacheEntry(promptCacheKey, entry);

    if (typeof promptCacheAdapter?.set !== 'function') {
        return;
    }

    try {
        await promptCacheAdapter.set(promptCacheKey, entry);
    } catch (error) {
        logServerWarn('[V-MATE] Prompt cache adapter set failed, kept in-memory cache only', {
            traceId,
            characterId: characterId || null,
            message: error?.message || String(error),
        });
    }
};

export const removePromptCacheWithAdapter = async ({
    promptCacheAdapter,
    promptCacheKey,
    traceId,
    characterId,
}) => {
    if (!promptCacheKey) {
        return;
    }

    removePromptCache(promptCacheKey);

    if (typeof promptCacheAdapter?.remove !== 'function') {
        return;
    }

    try {
        await promptCacheAdapter.remove(promptCacheKey);
    } catch (error) {
        logServerWarn('[V-MATE] Prompt cache adapter remove failed', {
            traceId,
            characterId: characterId || null,
            message: error?.message || String(error),
        });
    }
};
