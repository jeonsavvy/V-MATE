import { createHash } from 'node:crypto';
import {
    getRateLimitConfig,
    getRateLimitMaxKeys,
    shouldAllowAllOrigins,
    shouldAllowRequestsWithoutOrigin,
    shouldTrustProxyHeaders,
    shouldTrustForwardedFor,
} from './runtime-config.js';

const rateLimitStore = new Map();
let rateLimitGcTick = 0;
let cachedAllowedOriginsRaw = null;
let cachedAllowedOrigins = null;

const pruneExpiredRateLimitEntries = (now) => {
    for (const [cacheKey, value] of rateLimitStore.entries()) {
        if (!value?.resetAt || now > value.resetAt) {
            rateLimitStore.delete(cacheKey);
        }
    }
};

const trimRateLimitStoreToCapacity = (maxKeys, now) => {
    if (rateLimitStore.size < maxKeys) {
        return;
    }

    pruneExpiredRateLimitEntries(now);
    while (rateLimitStore.size >= maxKeys) {
        const oldestKey = rateLimitStore.keys().next().value;
        if (!oldestKey) {
            break;
        }
        rateLimitStore.delete(oldestKey);
    }
};

export const parseAllowedOrigins = () => {
    const raw = (process.env.ALLOWED_ORIGINS || '').trim();
    if (raw === cachedAllowedOriginsRaw && cachedAllowedOrigins) {
        return cachedAllowedOrigins;
    }

    let nextAllowlist;
    if (!raw) {
        nextAllowlist = new Set([
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'http://localhost:8888',
            'http://127.0.0.1:8888',
        ]);
    } else {
        nextAllowlist = new Set(
            raw
                .split(',')
                .map((origin) => origin.trim().replace(/\/+$/, ''))
                .filter(Boolean)
        );
    }

    cachedAllowedOriginsRaw = raw;
    cachedAllowedOrigins = nextAllowlist;
    return nextAllowlist;
};

export const normalizeOrigin = (origin) => String(origin || '').trim().replace(/\/+$/, '');

const readHeader = (headers, name) => {
    if (!headers) {
        return '';
    }

    if (typeof headers.get === 'function') {
        return String(headers.get(name) || headers.get(name.toLowerCase()) || '').trim();
    }

    return String(
        headers[name] ||
        headers[name.toLowerCase()] ||
        headers[name.replace(/(^|-)([a-z])/g, (_, prefix, char) => `${prefix}${char.toUpperCase()}`)] ||
        ''
    ).trim();
};

const isOriginlessSameOriginBrowserRequest = (requestOrigin, requestHeaders) => {
    if (!normalizeOrigin(requestOrigin)) {
        return false;
    }

    const fetchSite = readHeader(requestHeaders, 'sec-fetch-site').toLowerCase();
    if (!fetchSite) {
        return false;
    }

    return fetchSite === 'same-origin';
};

export const isOriginAllowed = (origin, requestOrigin = '', requestHeaders = undefined) => {
    if (shouldAllowAllOrigins()) {
        return true;
    }

    if (!origin) {
        if (shouldAllowRequestsWithoutOrigin()) {
            return true;
        }

        return isOriginlessSameOriginBrowserRequest(requestOrigin, requestHeaders);
    }

    const normalized = normalizeOrigin(origin);
    const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
    if (normalizedRequestOrigin && normalized === normalizedRequestOrigin) {
        return true;
    }
    const allowlist = parseAllowedOrigins();
    return allowlist.has(normalized);
};

const resolveClientIp = (event) => {
    const headers = event?.headers || {};
    const trustProxyHeaders = shouldTrustProxyHeaders();
    const cfRay = headers['cf-ray'] || headers['CF-Ray'];
    const fromCloudflareEdge = Boolean(String(cfRay || '').trim());
    const cfConnectingIp = headers['cf-connecting-ip'] || headers['CF-Connecting-IP'];
    if (cfConnectingIp && (fromCloudflareEdge || trustProxyHeaders)) {
        return String(cfConnectingIp).trim();
    }

    if (trustProxyHeaders) {
        const xRealIp = headers['x-real-ip'] || headers['X-Real-IP'];
        if (xRealIp) {
            return String(xRealIp).trim();
        }
    }

    if (trustProxyHeaders && shouldTrustForwardedFor()) {
        const forwardedFor = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
        if (forwardedFor) {
            const extracted = String(forwardedFor).split(',')[0].trim();
            if (extracted) {
                return extracted;
            }
        }
    }

    return '';
};

export const getClientKey = (event, origin) => {
    const ip = resolveClientIp(event);
    if (ip) return `ip:${ip}`;

    const normalizedOrigin = origin ? normalizeOrigin(origin) : '';
    const userAgent = String(event?.headers?.['user-agent'] || event?.headers?.['User-Agent'] || '').trim();
    const fingerprintSource = `${normalizedOrigin}|${userAgent}`;
    if (fingerprintSource && fingerprintSource !== '|') {
        const fingerprint = createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 16);
        return `fingerprint:${fingerprint}`;
    }

    if (normalizedOrigin) return `origin:${normalizedOrigin}`;
    return 'anonymous:unknown';
};

export const checkRateLimit = (key) => {
    const { windowMs, maxRequests } = getRateLimitConfig();
    const maxKeys = getRateLimitMaxKeys();
    const now = Date.now();
    rateLimitGcTick += 1;

    if (rateLimitGcTick % 200 === 0) {
        pruneExpiredRateLimitEntries(now);
    }

    const existing = rateLimitStore.get(key);
    if (existing && now <= existing.resetAt) {
        if (existing.count >= maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: Math.max(0, existing.resetAt - now),
            };
        }

        existing.count += 1;
        rateLimitStore.delete(key);
        rateLimitStore.set(key, existing);
        return {
            allowed: true,
            remaining: Math.max(0, maxRequests - existing.count),
            retryAfterMs: Math.max(0, existing.resetAt - now),
        };
    }

    if (existing) {
        rateLimitStore.delete(key);
    }
    trimRateLimitStoreToCapacity(maxKeys, now);

    if (!existing || now > existing.resetAt) {
        const next = {
            count: 1,
            resetAt: now + windowMs,
        };
        rateLimitStore.set(key, next);
        return { allowed: true, remaining: maxRequests - 1, retryAfterMs: windowMs };
    }
};

export const resetRateLimitStoreForTests = () => {
    rateLimitStore.clear();
    rateLimitGcTick = 0;
};

export const resetAllowedOriginCacheForTests = () => {
    cachedAllowedOriginsRaw = null;
    cachedAllowedOrigins = null;
};

export const buildHeaders = (originAllowed, origin) => {
    const resolvedOrigin = originAllowed ? (origin || '*') : 'null';
    const exposedHeaders = [
        'X-V-MATE-Trace-Id',
        'X-V-MATE-API-Version',
        'X-V-MATE-Elapsed-Ms',
        'X-V-MATE-Error-Code',
        'X-V-MATE-Dedupe-Status',
        'X-V-MATE-RateLimit-Limit',
        'X-V-MATE-RateLimit-Remaining',
        'X-V-MATE-RateLimit-Reset',
        'X-V-MATE-Client-Request-Id',
        'Retry-After',
    ].join(', ');

    return {
        'Access-Control-Allow-Origin': resolvedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, X-V-MATE-API-Version',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Expose-Headers': exposedHeaders,
        'Vary': 'Origin',
        'Cache-Control': 'no-store, max-age=0',
        'Pragma': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-V-MATE-Function': 'chat-v4',
        'Content-Type': 'application/json',
    };
};
