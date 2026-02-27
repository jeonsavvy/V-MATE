export const withElapsedHeader = (headers, startedAtMs) => ({
    ...headers,
    'X-V-MATE-Elapsed-Ms': String(Math.max(0, Date.now() - startedAtMs)),
});

export const withRateLimitHeaders = (headers, { remaining = 0, retryAfterMs = 0 }, maxRequests) => {
    const safeRemaining = Number.isFinite(Number(remaining)) ? Math.max(0, Number(remaining)) : 0;
    const safeLimit = Number.isFinite(Number(maxRequests)) ? Math.max(1, Number(maxRequests)) : 1;
    const retryAfterSeconds = Math.max(0, Math.ceil(Math.max(0, Number(retryAfterMs) || 0) / 1000));

    return {
        ...headers,
        'X-V-MATE-RateLimit-Limit': String(safeLimit),
        'X-V-MATE-RateLimit-Remaining': String(safeRemaining),
        'X-V-MATE-RateLimit-Reset': String(retryAfterSeconds),
    };
};

export const buildErrorPayload = ({ error, errorCode, traceId, retryable = false, details }) => ({
    error,
    error_code: errorCode,
    trace_id: traceId,
    ...(retryable ? { retryable: true } : {}),
    ...(details ? { details } : {}),
});

const toJsonBody = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

const withErrorCodeHeader = (headers, errorCode) => ({
    ...headers,
    ...(errorCode ? { 'X-V-MATE-Error-Code': String(errorCode) } : {}),
});

export const buildJsonResult = ({
    statusCode,
    headers,
    startedAtMs,
    body,
}) => ({
    statusCode,
    headers: withElapsedHeader(headers, startedAtMs),
    body: toJsonBody(body),
});

export const buildApiErrorResult = ({
    statusCode,
    headers,
    startedAtMs,
    traceId,
    error,
    errorCode,
    retryable = false,
    details,
}) =>
    buildJsonResult({
        statusCode,
        headers: withErrorCodeHeader(headers, errorCode),
        startedAtMs,
        body: buildErrorPayload({
            error,
            errorCode,
            traceId,
            retryable,
            details,
        }),
    });

export const buildChatSuccessPayload = ({
    apiVersion,
    payload,
    cachedContent,
    traceId,
}) =>
    apiVersion === '1'
        ? {
            text: JSON.stringify(payload),
            cachedContent,
            trace_id: traceId,
            api_version: '1',
        }
        : {
            message: payload,
            cachedContent,
            trace_id: traceId,
            api_version: '2',
        };
