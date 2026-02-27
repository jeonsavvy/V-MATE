import { createHash } from 'node:crypto';

const inflightRequestStore = new Map();
const replayResponseStore = new Map();
let dedupeGcTick = 0;

const cloneSerializable = (value) => {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
};

const pruneExpiredReplayEntries = (nowMs) => {
    for (const [key, entry] of replayResponseStore.entries()) {
        if (!entry?.expireAtMs || nowMs > entry.expireAtMs) {
            replayResponseStore.delete(key);
        }
    }
};

const pruneExpiredInFlightEntries = (nowMs) => {
    for (const [key, entry] of inflightRequestStore.entries()) {
        if (!entry?.expireAtMs || nowMs > entry.expireAtMs) {
            inflightRequestStore.delete(key);
        }
    }
};

const maybeRunDedupeGc = (nowMs) => {
    dedupeGcTick += 1;
    if (dedupeGcTick % 200 === 0) {
        pruneExpiredReplayEntries(nowMs);
        pruneExpiredInFlightEntries(nowMs);
    }
};

const trimReplayStoreByCapacity = (maxEntries, nowMs) => {
    if (replayResponseStore.size <= maxEntries) {
        return;
    }

    pruneExpiredReplayEntries(nowMs);

    while (replayResponseStore.size > maxEntries) {
        const oldestKey = replayResponseStore.keys().next().value;
        if (!oldestKey) {
            break;
        }
        replayResponseStore.delete(oldestKey);
    }
};

const trimInFlightStoreByCapacity = (maxEntries, nowMs) => {
    if (inflightRequestStore.size < maxEntries) {
        return;
    }

    pruneExpiredInFlightEntries(nowMs);
    while (inflightRequestStore.size >= maxEntries) {
        const oldestKey = inflightRequestStore.keys().next().value;
        if (!oldestKey) {
            break;
        }
        inflightRequestStore.delete(oldestKey);
    }
};

const normalizeWindowMs = (windowMs) => {
    const parsed = Number(windowMs);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.max(0, Math.floor(parsed));
};

export const buildRequestDedupeFingerprint = ({
    normalizedCharacterId,
    userMessage,
    messageHistory,
    cachedContent,
}) => {
    const payload = {
        characterId: String(normalizedCharacterId || '').trim().toLowerCase(),
        userMessage: String(userMessage || ''),
        messageHistory: Array.isArray(messageHistory)
            ? messageHistory.map((item) => ({
                role: item?.role === 'assistant' ? 'assistant' : 'user',
                content: String(item?.content || ''),
            }))
            : [],
        cachedContent: String(cachedContent || ''),
    };

    return createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex')
        .slice(0, 24);
};

export const buildRequestDedupeKey = ({ rateKey, clientRequestId, requestFingerprint }) => {
    const normalizedRateKey = String(rateKey || '').trim();
    const normalizedRequestId = String(clientRequestId || '').trim();
    const normalizedFingerprint = String(requestFingerprint || '').trim();

    if (!normalizedRateKey || !normalizedRequestId || !normalizedFingerprint) {
        return null;
    }

    return `${normalizedRateKey}:${normalizedRequestId}:${normalizedFingerprint}`;
};

export const withRequestDedupe = async ({
    dedupeKey,
    windowMs,
    maxEntries = 2000,
    shouldReplayResult = () => true,
    now = () => Date.now(),
    run,
}) => {
    if (typeof run !== 'function') {
        throw new Error('withRequestDedupe requires run function');
    }

    const normalizedKey = String(dedupeKey || '').trim();
    const normalizedWindowMs = normalizeWindowMs(windowMs);
    const normalizedMaxEntries = Math.max(100, Math.floor(Number(maxEntries) || 2000));

    if (!normalizedKey || normalizedWindowMs <= 0) {
        return {
            status: 'bypass',
            value: await run(),
        };
    }

    const nowMs = now();
    maybeRunDedupeGc(nowMs);

    const replayEntry = replayResponseStore.get(normalizedKey);
    if (replayEntry && nowMs <= replayEntry.expireAtMs) {
        replayResponseStore.delete(normalizedKey);
        replayResponseStore.set(normalizedKey, replayEntry);
        return {
            status: 'replay',
            value: cloneSerializable(replayEntry.value),
        };
    }

    if (replayEntry) {
        replayResponseStore.delete(normalizedKey);
    }

    const inflightEntry = inflightRequestStore.get(normalizedKey);
    if (inflightEntry && nowMs <= inflightEntry.expireAtMs) {
        const value = await inflightEntry.promise;
        return {
            status: 'inflight',
            value: cloneSerializable(value),
        };
    }

    if (inflightEntry) {
        inflightRequestStore.delete(normalizedKey);
    }

    const executionPromise = Promise.resolve().then(run);
    trimInFlightStoreByCapacity(normalizedMaxEntries, nowMs);
    inflightRequestStore.set(normalizedKey, {
        promise: executionPromise,
        expireAtMs: nowMs + Math.max(1000, normalizedWindowMs),
    });

    try {
        const value = await executionPromise;
        if (shouldReplayResult(value)) {
            replayResponseStore.set(normalizedKey, {
                value: cloneSerializable(value),
                expireAtMs: nowMs + normalizedWindowMs,
            });
            trimReplayStoreByCapacity(normalizedMaxEntries, nowMs);
        }

        return {
            status: 'fresh',
            value,
        };
    } finally {
        inflightRequestStore.delete(normalizedKey);
    }
};

export const resetRequestDedupeStoresForTests = () => {
    inflightRequestStore.clear();
    replayResponseStore.clear();
    dedupeGcTick = 0;
};
