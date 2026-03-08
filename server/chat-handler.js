/**
 * Cloudflare Worker Chat Handler: Gemini API 중계 서버
 * - API key 은닉
 * - Origin allowlist 기반 CORS
 * - Origin/IP 기반 rate limit
 * - Gemini 응답 JSON 정규화
 */
import { getSystemPromptForCharacter, isSupportedCharacterId } from './prompts.js';
import { buildHeaders, checkRateLimit, getClientKey, isOriginAllowed } from './modules/http-policy.js';
import {
    normalizeAssistantPayload,
} from './modules/response-normalizer.js';
import { executeGeminiChatRequest } from './modules/gemini-orchestrator.js';
import {
    removePromptCacheWithAdapter,
    resolvePromptCacheAdapter,
    resolveRateLimitState,
    setPromptCacheWithAdapter,
} from './modules/chat-context-hooks.js';
import {
    getRequestApiVersion,
    parseRequestBodyObject,
    validateChatRequestPayload,
} from './modules/request-schema.js';
import {
    buildApiErrorResult,
    buildChatSuccessPayload,
    buildJsonResult,
    withRateLimitHeaders,
} from './modules/http-response.js';
import { mapGeminiApiError } from './modules/upstream-error-map.js';
import { createTraceId } from './modules/trace-id.js';
import {
    getGeminiContextCacheConfig,
    getClientRequestDedupeConfig,
    getRateLimitConfig,
    getRequestBodyLimitBytes,
    shouldRequireJsonContentType,
} from './modules/runtime-config.js';
import { logServerError, logServerWarn } from './modules/server-logger.js';
import {
    buildRequestDedupeFingerprint,
    buildRequestDedupeKey,
    withRequestDedupe,
} from './modules/request-dedupe.js';
import { resolveAuthenticatedUser } from './modules/auth-guard.js';

const FIXED_GEMINI_MODEL_NAME = 'gemini-3-flash-preview';

export const handler = async (event, context) => {
    const requestStartedAt = Date.now();
    const requestTraceId = createTraceId();
    const origin = event.headers?.origin || event.headers?.Origin;
    const requestOrigin = event.headers?.['x-v-mate-request-origin'] || event.headers?.['X-V-MATE-Request-Origin'];
    const originAllowed = isOriginAllowed(origin, requestOrigin, event.headers);
    const headers = {
        ...buildHeaders(originAllowed, origin),
        'X-V-MATE-Trace-Id': requestTraceId,
    };
    const promptCacheAdapter = resolvePromptCacheAdapter(context);

    // OPTIONS 요청 처리 (CORS preflight)
    if (event.httpMethod === 'OPTIONS') {
        if (!originAllowed) {
            return buildApiErrorResult({
                statusCode: 403,
                headers,
                startedAtMs: requestStartedAt,
                traceId: requestTraceId,
                error: 'Origin is not allowed.',
                errorCode: 'ORIGIN_NOT_ALLOWED',
            });
        }

        return buildJsonResult({
            statusCode: 200,
            headers,
            startedAtMs: requestStartedAt,
            body: '',
        });
    }

    // POST 요청만 허용
    if (event.httpMethod !== 'POST') {
        const methodNotAllowedHeaders = {
            ...headers,
            Allow: 'POST, OPTIONS',
        };

        return buildApiErrorResult({
            statusCode: 405,
            headers: methodNotAllowedHeaders,
            startedAtMs: requestStartedAt,
            traceId: requestTraceId,
            error: 'Method not allowed',
            errorCode: 'METHOD_NOT_ALLOWED',
        });
    }

    if (!originAllowed) {
        return buildApiErrorResult({
            statusCode: 403,
            headers,
            startedAtMs: requestStartedAt,
            traceId: requestTraceId,
            error: 'Origin is not allowed.',
            errorCode: 'ORIGIN_NOT_ALLOWED',
        });
    }

    let { maxRequests: rateLimitMaxRequests } = getRateLimitConfig();
    const rateKey = getClientKey(event, origin);
    const rateState = await resolveRateLimitState({
        context,
        event,
        origin,
        rateKey,
        defaultLimit: rateLimitMaxRequests,
        getDefaultStatus: () => checkRateLimit(rateKey),
        traceId: requestTraceId,
    });
    const rateStatus = rateState.status;
    rateLimitMaxRequests = rateState.limit;
    let rateLimitedHeaders = withRateLimitHeaders(headers, rateStatus, rateLimitMaxRequests);
    if (!rateStatus.allowed) {
        return buildApiErrorResult({
            statusCode: 429,
            headers: {
                ...rateLimitedHeaders,
                'Retry-After': String(Math.ceil(rateStatus.retryAfterMs / 1000)),
            },
            startedAtMs: requestStartedAt,
            error: 'Too many requests. Please try again later.',
            errorCode: 'RATE_LIMIT_EXCEEDED',
            traceId: requestTraceId,
            retryable: true,
        });
    }

    try {
        const authResult = await resolveAuthenticatedUser({
            event,
            requestTraceId,
        });
        if (!authResult.ok) {
            return buildApiErrorResult({
                statusCode: authResult.statusCode || 401,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: authResult.error || 'Authentication required.',
                errorCode: authResult.errorCode || 'AUTH_REQUIRED',
                traceId: requestTraceId,
                retryable: Boolean(authResult.retryable),
            });
        }
        const authenticatedUserId = String(authResult.userId || '').trim();

        const apiKey = process.env.GOOGLE_API_KEY;
        const contentType = String(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
        if (shouldRequireJsonContentType() && !contentType.includes('application/json')) {
            return buildApiErrorResult({
                statusCode: 415,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: 'Content-Type must be application/json.',
                errorCode: 'UNSUPPORTED_CONTENT_TYPE',
                traceId: requestTraceId,
            });
        }
        const bodyText = String(event.body || '');
        const bodyByteLength = new TextEncoder().encode(bodyText).length;
        if (bodyByteLength > getRequestBodyLimitBytes()) {
            return buildApiErrorResult({
                statusCode: 413,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: 'Request body is too large.',
                errorCode: 'REQUEST_BODY_TOO_LARGE',
                traceId: requestTraceId,
            });
        }

        if (!apiKey) {
            return buildApiErrorResult({
                statusCode: 500,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: 'API key not configured. Please set GOOGLE_API_KEY in runtime secrets.',
                errorCode: 'SERVER_API_KEY_NOT_CONFIGURED',
                traceId: requestTraceId,
            });
        }

        const parsedBody = parseRequestBodyObject(bodyText);
        if (!parsedBody.ok) {
            return buildApiErrorResult({
                statusCode: 400,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: parsedBody.error,
                errorCode: parsedBody.errorCode,
                traceId: requestTraceId,
                details: parsedBody.details,
            });
        }

        const requestData = parsedBody.data;

        const requestApiVersion = getRequestApiVersion(event, requestData);
        headers['X-V-MATE-API-Version'] = requestApiVersion;
        rateLimitedHeaders = withRateLimitHeaders(headers, rateStatus, rateLimitMaxRequests);

        const validatedRequest = validateChatRequestPayload(requestData, {
            isSupportedCharacterId,
        });
        if (!validatedRequest.ok) {
            return buildApiErrorResult({
                statusCode: 400,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: validatedRequest.error,
                errorCode: validatedRequest.errorCode,
                traceId: requestTraceId,
            });
        }
        const {
            userMessage,
            messageHistory,
            cachedContent,
            clientRequestId,
            normalizedCharacterId,
        } = validatedRequest.value;
        const trimmedSystemPrompt = String(getSystemPromptForCharacter(normalizedCharacterId) || '').trim();
        if (clientRequestId) {
            headers['X-V-MATE-Client-Request-Id'] = clientRequestId;
            rateLimitedHeaders = withRateLimitHeaders(headers, rateStatus, rateLimitMaxRequests);
        }
        const logMeta = {
            traceId: requestTraceId,
            characterId: normalizedCharacterId || null,
            clientRequestId: clientRequestId || null,
            hasAuthenticatedUser: Boolean(authenticatedUserId),
        };

        const executeModelAndNormalize = async () => {
            const geminiResult = await executeGeminiChatRequest({
                apiKey,
                modelName: FIXED_GEMINI_MODEL_NAME,
                requestStartedAt,
                requestTraceId,
                normalizedCharacterId,
                userMessage,
                messageHistory,
                requestCachedContent: cachedContent,
                trimmedSystemPrompt,
                promptCacheAdapter,
            });

            if (!geminiResult.ok) {
                const upstreamErrorCode = geminiResult.error?.code || 'UPSTREAM_UNKNOWN_ERROR';
                logServerWarn('[V-MATE] Returning hard error for upstream failure', {
                    ...logMeta,
                    upstreamErrorCode,
                    elapsedMs: Math.max(0, Date.now() - requestStartedAt),
                });

                return {
                    ok: false,
                    statusCode: geminiResult.error?.status || 503,
                    error: geminiResult.error?.message || 'Model call failed. Please try again later.',
                    errorCode: upstreamErrorCode,
                    retryable: Boolean(geminiResult.retryable),
                };
            }

            const {
                geminiResponse,
                geminiData,
                modelText,
                cachedContentName: initialCachedContentName,
                promptCacheKey,
                canUseContextCache,
            } = geminiResult;
            let responseCachedContent = initialCachedContentName || null;

            if (!geminiResponse?.ok || geminiData?.error) {
                const { errorMessage, errorCode } = mapGeminiApiError(geminiData);
                return {
                    ok: false,
                    statusCode: geminiResponse?.status || 500,
                    error: errorMessage,
                    errorCode,
                };
            }

            const normalizedPayload = normalizeAssistantPayload(modelText, {
                ...logMeta,
                finishReason: geminiData?.candidates?.[0]?.finishReason || null,
                promptBlockReason: geminiData?.promptFeedback?.blockReason || null,
            });
            const isFormatFallback =
                normalizedPayload.response === '잠시 응답 형식이 불안정했어요. 한 번만 다시 말해줘.' &&
                normalizedPayload.inner_heart === '';
            if (isFormatFallback) {
                logServerWarn('[V-MATE] Returning hard error for format fallback payload', {
                    ...logMeta,
                    modelTextLength: String(modelText || '').length,
                });
                if (responseCachedContent) {
                    await removePromptCacheWithAdapter({
                        promptCacheAdapter,
                        promptCacheKey,
                        traceId: requestTraceId,
                        characterId: normalizedCharacterId,
                    });
                    responseCachedContent = null;
                }
                return {
                    ok: false,
                    statusCode: 502,
                    error: 'Gemini response format validation failed.',
                    errorCode: 'UPSTREAM_INVALID_FORMAT',
                };
            }
            const finalPayload = normalizedPayload;

            if (canUseContextCache && promptCacheKey && responseCachedContent) {
                const { ttlSeconds } = getGeminiContextCacheConfig();
                await setPromptCacheWithAdapter({
                    promptCacheAdapter,
                    promptCacheKey,
                    traceId: requestTraceId,
                    characterId: normalizedCharacterId,
                    entry: {
                        name: responseCachedContent,
                        expireAtMs: Date.now() + Math.max(300, ttlSeconds) * 1000,
                    },
                });
            }

            return {
                ok: true,
                payload: finalPayload,
                cachedContent: responseCachedContent,
            };
        };

        const dedupeConfig = getClientRequestDedupeConfig();
        const requestScopeKey = authenticatedUserId ? `user:${authenticatedUserId}` : rateKey;
        const requestFingerprint = buildRequestDedupeFingerprint({
            normalizedCharacterId,
            userMessage,
            messageHistory,
            cachedContent,
        });
        const requestDedupeKey = buildRequestDedupeKey({
            rateKey: requestScopeKey,
            clientRequestId,
            requestFingerprint,
        });

        const dedupeResult = await withRequestDedupe({
            dedupeKey: requestDedupeKey,
            windowMs: dedupeConfig.windowMs,
            maxEntries: dedupeConfig.maxEntries,
            shouldReplayResult: (value) => Boolean(value?.ok),
            run: executeModelAndNormalize,
        });
        if (dedupeResult?.status) {
            headers['X-V-MATE-Dedupe-Status'] = dedupeResult.status;
            rateLimitedHeaders = withRateLimitHeaders(headers, rateStatus, rateLimitMaxRequests);
        }
        const modelResult = dedupeResult.value;
        if (!modelResult?.ok) {
            return buildApiErrorResult({
                statusCode: modelResult?.statusCode || 500,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: modelResult?.error || 'Internal server error.',
                errorCode: modelResult?.errorCode || 'INTERNAL_SERVER_ERROR',
                traceId: requestTraceId,
                retryable: Boolean(modelResult?.retryable),
            });
        }

        return buildJsonResult({
            statusCode: 200,
            headers: rateLimitedHeaders,
            startedAtMs: requestStartedAt,
            body: buildChatSuccessPayload({
                apiVersion: requestApiVersion,
                payload: modelResult.payload,
                cachedContent: modelResult.cachedContent,
                traceId: requestTraceId,
            }),
        });
    } catch (error) {
        logServerError('[V-MATE] Unexpected error', {
            traceId: requestTraceId,
            characterId: null,
            message: error?.message || String(error),
        });

        return buildApiErrorResult({
            statusCode: 500,
            headers: rateLimitedHeaders,
            startedAtMs: requestStartedAt,
            error: 'Internal server error. Please try again later.',
            errorCode: 'INTERNAL_SERVER_ERROR',
            traceId: requestTraceId,
            details: process.env.CLOUDFLARE_DEV ? error.message : undefined,
        });
    }
};
