import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { handler as chatHandler } from './chat-handler.js';
import { buildHeaders, isOriginAllowed } from './modules/http-policy.js';
import { buildApiErrorResult } from './modules/http-response.js';
import { mergeChatHandlerContexts, resolveChatHandlerContext } from './modules/chat-handler-context.js';
import { getRequestBodyLimitBytes } from './modules/runtime-config.js';
import { resolveRuntimeChatHandlerContext } from './modules/runtime-chat-context.js';
import { logServerInfo, logServerWarn } from './modules/server-logger.js';
import { createTraceId } from './modules/trace-id.js';

const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
};

const normalizeHeaders = (headers) =>
    Object.fromEntries(
        Object.entries(headers || {}).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(',') : String(value ?? ''),
        ])
    );

const readRawBody = (req) =>
    new Promise((resolve, reject) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
            resolve('');
            return;
        }

        let body = '';
        let byteLength = 0;
        let settled = false;
        const maxBodyBytes = getRequestBodyLimitBytes();
        const contentLengthHeader = req.headers?.['content-length'];
        const contentLength = Number.parseInt(String(contentLengthHeader || ''), 10);
        if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
            const error = new Error('Request body too large');
            error.code = 'REQUEST_BODY_TOO_LARGE';
            req.resume();
            reject(error);
            return;
        }

        const rejectOnce = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            reject(error);
        };
        const resolveOnce = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(value);
        };

        req.on('data', (chunk) => {
            if (settled) {
                return;
            }

            const chunkBytes = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
            byteLength += chunkBytes;
            if (byteLength > maxBodyBytes) {
                const error = new Error('Request body too large');
                error.code = 'REQUEST_BODY_TOO_LARGE';
                req.resume();
                rejectOnce(error);
                return;
            }

            body += chunk;
        });
        req.on('end', () => {
            resolveOnce(body);
        });
        req.on('error', rejectOnce);
    });

const toEvent = async (req) => ({
    httpMethod: req.method || 'GET',
    headers: normalizeHeaders(req.headers),
    body: await readRawBody(req),
});

const sendResult = (res, result, fallbackHeaders = DEFAULT_HEADERS) => {
    res.writeHead(result?.statusCode || 500, {
        ...fallbackHeaders,
        ...(result?.headers || {}),
    });
    res.end(result?.body || '');
};

export const createCloudRunServer = ({
    chatHandlerImpl = chatHandler,
    chatHandlerContext = {},
    runtimeEnv = process.env,
} = {}) =>
    http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

        if (url.pathname === '/healthz') {
            res.writeHead(200, DEFAULT_HEADERS);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (url.pathname !== '/api/chat' && url.pathname !== '/api/chat/') {
            res.writeHead(404, DEFAULT_HEADERS);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        const requestStartedAt = Date.now();
        const requestTraceId = createTraceId();
        const origin = req.headers?.origin;
        const originAllowed = isOriginAllowed(origin);
        const responseHeaders = {
            ...buildHeaders(originAllowed, origin),
            'X-V-MATE-Trace-Id': requestTraceId,
        };

        if (!originAllowed) {
            sendResult(res, buildApiErrorResult({
                statusCode: 403,
                headers: responseHeaders,
                startedAtMs: requestStartedAt,
                traceId: requestTraceId,
                error: 'Origin is not allowed.',
                errorCode: 'ORIGIN_NOT_ALLOWED',
            }));
            return;
        }

        try {
            const event = await toEvent(req);
            const configuredContext = await resolveChatHandlerContext({
                chatHandlerContext,
                resolverInput: { req },
                onError: (error) => {
                    logServerWarn('[V-MATE] Cloud Run chatHandlerContext resolver failed, using empty context', {
                        traceId: requestTraceId,
                        message: error?.message || String(error),
                    });
                },
            });
            const runtimeContext = resolveRuntimeChatHandlerContext({
                env: runtimeEnv,
                traceId: requestTraceId,
            });
            const handlerContext = mergeChatHandlerContexts(runtimeContext, configuredContext);
            const result = await chatHandlerImpl(event, handlerContext);
            sendResult(res, result, responseHeaders);
        } catch (error) {
            if (error?.code === 'REQUEST_BODY_TOO_LARGE') {
                sendResult(res, buildApiErrorResult({
                    statusCode: 413,
                    headers: responseHeaders,
                    startedAtMs: requestStartedAt,
                    traceId: requestTraceId,
                    error: 'Request body too large',
                    errorCode: 'REQUEST_BODY_TOO_LARGE',
                }));
                return;
            }

            sendResult(res, buildApiErrorResult({
                statusCode: 500,
                headers: responseHeaders,
                startedAtMs: requestStartedAt,
                traceId: requestTraceId,
                error: 'Internal server error.',
                errorCode: 'INTERNAL_SERVER_ERROR',
                details: process.env.NODE_ENV !== 'production'
                    ? (error?.message || String(error))
                    : undefined,
            }));
        }
    });

const runAsCli = () => {
    const server = createCloudRunServer();
    const port = Number(process.env.PORT || 8080);
    server.listen(port, () => {
        logServerInfo('[V-MATE] Cloud Run server listening', { port });
    });
};

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
    runAsCli();
}
