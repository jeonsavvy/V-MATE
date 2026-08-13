import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { handler as chatHandler } from './chat-handler.js';
import { executeApiIngress } from './modules/api-ingress.js';
import { CORS_ALLOWED_METHODS } from './modules/http-policy.js';
import { mergeChatHandlerContexts, resolveChatHandlerContext } from './modules/chat-handler-context.js';
import { createRuntimeConfig } from './modules/runtime-config.js';
import { resolveRuntimeEnvironmentChatContext } from './modules/runtime-environment-chat-context.js';
import { createRuntimeEnvironment } from './modules/runtime-environment.js';
import { toSafeErrorMeta } from './modules/safe-error-meta.js';
import { logServerInfo, logServerWarn } from './modules/server-logger.js';
import { handlePlatformApi } from './platform/api.js';

// Cloud Run adapter는 Worker와 같은 API 계약을 Node HTTP 서버로 재현한다.
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

// Node 스트림에서도 Worker와 같은 body 제한을 먼저 적용한다.
const readRawBody = (req, maxBodyBytes) =>
    new Promise((resolve, reject) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
            resolve('');
            return;
        }

        let body = '';
        let byteLength = 0;
        let settled = false;
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

const toEvent = async (req, url, maxBodyBytes, requestContext) => ({
    httpMethod: req.method || 'GET',
    headers: {
        ...normalizeHeaders(req.headers),
        'x-v-mate-request-origin': url.origin,
    },
    path: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    requestContext: { traceId: requestContext.traceId },
    body: await readRawBody(req, maxBodyBytes),
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
    runtimeConfig,
} = {}) => {
    const resolvedRuntimeConfig = runtimeConfig || createRuntimeConfig(
        createRuntimeEnvironment(process.env, runtimeEnv)
    );

    return http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

        // healthz는 배포 환경에서 가장 먼저 확인하는 단순 생존 신호로 유지한다.
        if (url.pathname === '/healthz') {
            res.writeHead(200, DEFAULT_HEADERS);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        const isChatPath = url.pathname === '/api/chat' || url.pathname === '/api/chat/';
        const isApiPath = url.pathname.startsWith('/api/');

        if (!isApiPath) {
            res.writeHead(404, DEFAULT_HEADERS);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        const origin = req.headers?.origin;
        const result = await executeApiIngress({
            origin,
            requestOrigin: url.origin,
            requestHeaders: req.headers,
            allowedMethods: isChatPath ? CORS_ALLOWED_METHODS.chat : CORS_ALLOWED_METHODS.platform,
            runtimeConfig: resolvedRuntimeConfig,
            bodyTooLargeMessage: 'Request body too large',
            createEvent: (requestContext) => toEvent(
                req,
                url,
                resolvedRuntimeConfig.requestBodyLimitBytes,
                requestContext
            ),
            handle: async ({ event, requestContext }) => {
                // chat과 platform 흐름을 나눠야 동일한 가드레일을 유지하면서도 제품 API를 확장하기 쉽다.
                if (!isChatPath) {
                    return handlePlatformApi({
                        event,
                        headers: requestContext.responseHeaders,
                        startedAtMs: requestContext.startedAtMs,
                        traceId: requestContext.traceId,
                        requestContext,
                        runtimeConfig: resolvedRuntimeConfig,
                        runtimeEnvironment: resolvedRuntimeConfig.environment,
                    });
                }

                const configuredContext = await resolveChatHandlerContext({
                    chatHandlerContext,
                    resolverInput: {
                        req,
                        requestContext,
                        runtimeConfig: resolvedRuntimeConfig,
                        env: resolvedRuntimeConfig.environment,
                    },
                    onError: (error) => {
                        logServerWarn('[V-MATE] Request context resolver failed, using empty context', {
                            traceId: requestContext.traceId,
                            ...toSafeErrorMeta(error),
                        });
                    },
                });
                const runtimeContext = resolveRuntimeEnvironmentChatContext({
                    runtimeConfig: resolvedRuntimeConfig,
                    traceId: requestContext.traceId,
                });
                const handlerContext = Object.freeze({
                    ...mergeChatHandlerContexts(runtimeContext, configuredContext),
                    traceId: requestContext.traceId,
                    requestContext,
                    runtimeConfig: resolvedRuntimeConfig,
                    runtimeEnvironment: resolvedRuntimeConfig.environment,
                });
                return chatHandlerImpl(event, handlerContext);
            },
        });
        sendResult(res, result, result?.headers);
    });
};

const runAsCli = () => {
    const server = createCloudRunServer();
    const port = Number(process.env.PORT || 8080);
    server.listen(port, () => {
        logServerInfo('[V-MATE] Server listening', { port });
    });
};

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
    runAsCli();
}
