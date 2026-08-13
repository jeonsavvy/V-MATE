import { buildHeaders } from './http-policy.js';
import { buildApiErrorResult } from './http-response.js';
import { createTraceId } from './trace-id.js';

const normalizeOrigin = (origin) => String(origin || '').trim().replace(/\/+$/, '');

const readHeader = (headers, name) => {
    if (!headers) {
        return '';
    }

    if (typeof headers.get === 'function') {
        return String(headers.get(name) || headers.get(name.toLowerCase()) || '').trim();
    }

    return String(
        headers[name]
        || headers[name.toLowerCase()]
        || headers[name.replace(/(^|-)([a-z])/g, (_, prefix, char) => `${prefix}${char.toUpperCase()}`)]
        || ''
    ).trim();
};

const isOriginlessSameOriginBrowserRequest = (requestOrigin, requestHeaders) => (
    Boolean(normalizeOrigin(requestOrigin))
    && readHeader(requestHeaders, 'sec-fetch-site').toLowerCase() === 'same-origin'
);

export const isIngressOriginAllowed = ({
    origin,
    requestOrigin,
    requestHeaders,
    runtimeConfig,
}) => {
    const cors = runtimeConfig?.cors || {};
    if (cors.allowAllOrigins) {
        return true;
    }

    if (!origin) {
        return Boolean(cors.allowRequestsWithoutOrigin)
            || isOriginlessSameOriginBrowserRequest(requestOrigin, requestHeaders);
    }

    const normalized = normalizeOrigin(origin);
    const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
    if (normalizedRequestOrigin && normalized === normalizedRequestOrigin) {
        return true;
    }

    return Array.isArray(cors.allowedOrigins) && cors.allowedOrigins.includes(normalized);
};

export const createApiIngressContext = ({
    origin,
    requestOrigin,
    requestHeaders,
    allowedMethods,
    runtimeConfig,
    executionContext,
    traceId = createTraceId(),
    startedAtMs = Date.now(),
}) => {
    const originAllowed = isIngressOriginAllowed({
        origin,
        requestOrigin,
        requestHeaders,
        runtimeConfig,
    });
    const responseHeaders = Object.freeze({
        ...buildHeaders(originAllowed, origin, { allowedMethods }),
        'X-V-MATE-Trace-Id': traceId,
    });

    return Object.freeze({
        traceId,
        startedAtMs,
        originAllowed,
        responseHeaders,
        runtimeConfig,
        runtimeEnvironment: runtimeConfig?.environment,
        executionContext,
    });
};

const withIngressHeaders = (result, requestContext) => ({
    ...(result || {}),
    headers: {
        ...requestContext.responseHeaders,
        ...(result?.headers || {}),
        'X-V-MATE-Trace-Id': requestContext.traceId,
    },
});

/**
 * Apply transport-independent ingress policy once, then invoke an adapter's
 * bounded body reader and core handler with the same immutable request context.
 */
export const executeApiIngress = async ({
    createEvent,
    handle,
    origin,
    requestOrigin,
    requestHeaders,
    allowedMethods,
    runtimeConfig,
    executionContext,
    bodyTooLargeMessage = 'Request body is too large.',
    traceId,
    startedAtMs,
}) => {
    const requestContext = createApiIngressContext({
        origin,
        requestOrigin,
        requestHeaders,
        allowedMethods,
        runtimeConfig,
        executionContext,
        traceId,
        startedAtMs,
    });

    if (!requestContext.originAllowed) {
        return withIngressHeaders(buildApiErrorResult({
            statusCode: 403,
            headers: requestContext.responseHeaders,
            startedAtMs: requestContext.startedAtMs,
            traceId: requestContext.traceId,
            error: 'Origin is not allowed.',
            errorCode: 'ORIGIN_NOT_ALLOWED',
        }), requestContext);
    }

    try {
        const event = await createEvent(requestContext);
        const result = await handle({ event, requestContext });
        return withIngressHeaders(result, requestContext);
    } catch (error) {
        const bodyTooLarge = error?.code === 'REQUEST_BODY_TOO_LARGE';
        return withIngressHeaders(buildApiErrorResult({
            statusCode: bodyTooLarge ? 413 : 500,
            headers: requestContext.responseHeaders,
            startedAtMs: requestContext.startedAtMs,
            traceId: requestContext.traceId,
            error: bodyTooLarge ? bodyTooLargeMessage : 'Internal server error.',
            errorCode: bodyTooLarge ? 'REQUEST_BODY_TOO_LARGE' : 'INTERNAL_SERVER_ERROR',
            details: undefined,
        }), requestContext);
    }
};
