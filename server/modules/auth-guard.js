import { getChatAuthConfig } from './runtime-config.js';
import { logServerWarn } from './server-logger.js';

const NETWORK_ERROR_PATTERN = /(network|fetch|econn|eai_again|enotfound|etimedout|socket|tls)/i;

const readHeaderValue = (headers, headerName) => {
    if (!headers || typeof headers !== 'object') {
        return '';
    }

    const directValue = headers[headerName] || headers[headerName.toLowerCase()] || headers[headerName.toUpperCase()];
    if (directValue) {
        return String(directValue).trim();
    }

    const normalizedTarget = String(headerName || '').trim().toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (String(key || '').trim().toLowerCase() === normalizedTarget) {
            return String(value || '').trim();
        }
    }

    return '';
};

export const extractBearerToken = (headers) => {
    const authorization = readHeaderValue(headers, 'authorization');
    if (!authorization) {
        return '';
    }

    const [scheme, token] = authorization.split(/\s+/, 2);
    if (String(scheme || '').toLowerCase() !== 'bearer') {
        return '';
    }

    return String(token || '').trim();
};

const parseJwtPayload = (token) => {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
        return null;
    }

    const rawPayload = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');

    try {
        let decoded = '';
        if (typeof atob === 'function') {
            decoded = atob(rawPayload);
        } else if (typeof Buffer !== 'undefined') {
            decoded = Buffer.from(rawPayload, 'base64').toString('utf8');
        } else {
            return null;
        }
        const payload = JSON.parse(decoded);
        return payload && typeof payload === 'object' ? payload : null;
    } catch {
        return null;
    }
};

const normalizeSupabaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

export const resolveSupabaseUrlFromAccessToken = (accessToken) => {
    const payload = parseJwtPayload(accessToken);
    const issuer = normalizeSupabaseUrl(payload?.iss);
    if (!issuer) {
        return '';
    }

    if (issuer.endsWith('/auth/v1')) {
        return issuer.slice(0, -'/auth/v1'.length);
    }

    return issuer;
};

const buildAuthProviderUserUrl = (supabaseUrl) => `${normalizeSupabaseUrl(supabaseUrl)}/auth/v1/user`;

const isRetryableStatus = (statusCode) => Number(statusCode) === 429 || Number(statusCode) >= 500;

const isNetworkFailure = (error) => {
    const message = String(error?.message || '');
    return NETWORK_ERROR_PATTERN.test(message);
};

const isAbortFailure = (error) => error?.name === 'AbortError';

const toAuthFailure = ({
    statusCode,
    errorCode,
    error,
    retryable = false,
}) => ({
    ok: false,
    statusCode,
    errorCode,
    error,
    retryable,
});

const parseUserIdFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    if (typeof payload.id === 'string' && payload.id.trim()) {
        return payload.id.trim();
    }

    if (payload.user && typeof payload.user === 'object' && typeof payload.user.id === 'string' && payload.user.id.trim()) {
        return payload.user.id.trim();
    }

    return '';
};

const readAuthProviderErrorMessage = (payload) => {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const candidates = [
        payload.message,
        payload.error_description,
        payload.msg,
        payload.error?.message,
        payload.error,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    return '';
};

const looksLikeMissingApiKeyError = (message) =>
    /(api[_\s-]?key|apikey|publishable key|anon key|missing key)/i.test(String(message || ''));

const verifyAccessTokenWithAuthProvider = async ({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    timeoutMs,
    retryCount,
    fetchImpl,
    traceId,
}) => {
    const totalAttempts = Math.max(1, Number(retryCount) + 1);
    const userUrl = buildAuthProviderUserUrl(supabaseUrl);

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetchImpl(userUrl, {
                method: 'GET',
                headers: {
                    ...(supabaseAnonKey ? { apikey: supabaseAnonKey } : {}),
                    authorization: `Bearer ${accessToken}`,
                },
                signal: controller.signal,
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }

            if (response.ok) {
                const userId = parseUserIdFromPayload(payload);
                if (!userId) {
                    return toAuthFailure({
                        statusCode: 502,
                        errorCode: 'AUTH_PROVIDER_INVALID_RESPONSE',
                        error: 'Authentication provider returned invalid response.',
                    });
                }

                return {
                    ok: true,
                    userId,
                };
            }

            if (response.status === 401 || response.status === 403) {
                const providerErrorMessage = readAuthProviderErrorMessage(payload);
                if (looksLikeMissingApiKeyError(providerErrorMessage)) {
                    return toAuthFailure({
                        statusCode: 503,
                        errorCode: 'AUTH_PROVIDER_NOT_CONFIGURED',
                        error: 'Authentication provider API key is not configured.',
                    });
                }

                return toAuthFailure({
                    statusCode: 401,
                    errorCode: 'AUTH_UNAUTHORIZED',
                    error: 'Authentication failed. Please sign in again.',
                });
            }

            if (isRetryableStatus(response.status) && attempt < totalAttempts) {
                continue;
            }

            return toAuthFailure({
                statusCode: isRetryableStatus(response.status) ? 503 : 502,
                errorCode: isRetryableStatus(response.status)
                    ? 'AUTH_PROVIDER_UNAVAILABLE'
                    : 'AUTH_PROVIDER_ERROR',
                error: 'Authentication provider is unavailable.',
                retryable: isRetryableStatus(response.status),
            });
        } catch (error) {
            if (isAbortFailure(error)) {
                if (attempt < totalAttempts) {
                    continue;
                }
                return toAuthFailure({
                    statusCode: 504,
                    errorCode: 'AUTH_PROVIDER_TIMEOUT',
                    error: 'Authentication provider timed out.',
                    retryable: true,
                });
            }

            if (isNetworkFailure(error)) {
                if (attempt < totalAttempts) {
                    continue;
                }
                return toAuthFailure({
                    statusCode: 503,
                    errorCode: 'AUTH_PROVIDER_UNAVAILABLE',
                    error: 'Authentication provider is unavailable.',
                    retryable: true,
                });
            }

            logServerWarn('[V-MATE] Auth provider request failed with non-retryable error', {
                traceId,
                message: error?.message || String(error),
            });

            return toAuthFailure({
                statusCode: 502,
                errorCode: 'AUTH_PROVIDER_ERROR',
                error: 'Authentication provider request failed.',
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    return toAuthFailure({
        statusCode: 503,
        errorCode: 'AUTH_PROVIDER_UNAVAILABLE',
        error: 'Authentication provider is unavailable.',
        retryable: true,
    });
};

export const resolveAuthenticatedUser = async ({
    event,
    requestTraceId,
    fetchImpl = globalThis.fetch,
}) => {
    const {
        requireAuth,
        authProviderTimeoutMs,
        authProviderRetryCount,
        supabaseUrl: configuredSupabaseUrl,
        supabaseAnonKey,
    } = getChatAuthConfig();

    if (!requireAuth) {
        return {
            ok: true,
            userId: '',
        };
    }

    const accessToken = extractBearerToken(event?.headers);
    if (!accessToken) {
        return toAuthFailure({
            statusCode: 401,
            errorCode: 'AUTH_REQUIRED',
            error: 'Authentication required. Please sign in.',
        });
    }

    if (typeof fetchImpl !== 'function') {
        return toAuthFailure({
            statusCode: 503,
            errorCode: 'AUTH_PROVIDER_UNAVAILABLE',
            error: 'Authentication provider fetch is not available.',
            retryable: true,
        });
    }

    const resolvedSupabaseUrl = normalizeSupabaseUrl(
        configuredSupabaseUrl || resolveSupabaseUrlFromAccessToken(accessToken)
    );
    if (!resolvedSupabaseUrl) {
        return toAuthFailure({
            statusCode: 503,
            errorCode: 'AUTH_PROVIDER_NOT_CONFIGURED',
            error: 'Authentication provider is not configured.',
        });
    }

    if (!String(supabaseAnonKey || '').trim()) {
        return toAuthFailure({
            statusCode: 503,
            errorCode: 'AUTH_PROVIDER_NOT_CONFIGURED',
            error: 'Authentication provider key is not configured.',
        });
    }

    return verifyAccessTokenWithAuthProvider({
        supabaseUrl: resolvedSupabaseUrl,
        supabaseAnonKey,
        accessToken,
        timeoutMs: authProviderTimeoutMs,
        retryCount: authProviderRetryCount,
        fetchImpl,
        traceId: requestTraceId,
    });
};
