import { createHash } from 'node:crypto';
import { getPromptCacheMaxEntries } from './runtime-config.js';

const promptCacheStore = new Map();
const EXPIRY_BUFFER_MS = 15_000;
let promptCacheGcTick = 0;

const pruneExpiredPromptCaches = (now = Date.now()) => {
    for (const [cacheKey, entry] of promptCacheStore.entries()) {
        if (!entry?.expireAtMs || now >= entry.expireAtMs - EXPIRY_BUFFER_MS) {
            promptCacheStore.delete(cacheKey);
        }
    }
};

const maybeRunPromptCacheGc = () => {
    promptCacheGcTick += 1;
    if (promptCacheGcTick % 200 === 0) {
        pruneExpiredPromptCaches();
    }
};

const trimPromptCacheByCapacity = () => {
    const maxEntries = getPromptCacheMaxEntries();
    if (promptCacheStore.size <= maxEntries) {
        return;
    }

    pruneExpiredPromptCaches();

    while (promptCacheStore.size > maxEntries) {
        const oldestKey = promptCacheStore.keys().next().value;
        if (!oldestKey) {
            break;
        }
        promptCacheStore.delete(oldestKey);
    }
};

export const toStablePromptHash = (prompt) =>
    createHash('sha256')
        .update(String(prompt || ''))
        .digest('hex')
        .slice(0, 24);

export const buildPromptCacheKey = (characterId, promptHash) => `${characterId}:${promptHash}`;

export const getValidPromptCache = (cacheKey) => {
    maybeRunPromptCacheGc();
    const entry = promptCacheStore.get(cacheKey);
    if (!entry) {
        return null;
    }

    if (!entry.expireAtMs || Date.now() >= entry.expireAtMs - EXPIRY_BUFFER_MS) {
        promptCacheStore.delete(cacheKey);
        return null;
    }

    promptCacheStore.delete(cacheKey);
    promptCacheStore.set(cacheKey, entry);
    return entry;
};

export const setPromptCacheEntry = (cacheKey, entry) => {
    if (!cacheKey || !entry?.name) {
        return;
    }
    maybeRunPromptCacheGc();
    if (promptCacheStore.has(cacheKey)) {
        promptCacheStore.delete(cacheKey);
    }
    promptCacheStore.set(cacheKey, entry);
    trimPromptCacheByCapacity();
};

export const removePromptCache = (cacheKey) => {
    if (!cacheKey) return;
    promptCacheStore.delete(cacheKey);
};

export const resetPromptCacheStoreForTests = () => {
    promptCacheStore.clear();
    promptCacheGcTick = 0;
};

export const isValidCachedContentName = (value) => {
    const text = String(value || '').trim();
    if (!text.startsWith('cachedContents/')) {
        return false;
    }
    return /^[A-Za-z0-9/_\-.]+$/.test(text);
};

export const parseCachedContentName = (value) => {
    const text = String(value || '').trim();
    return isValidCachedContentName(text) ? text : null;
};
