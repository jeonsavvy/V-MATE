/**
 * Cloudflare Worker Chat Handler: Gemini API 중계 서버
 * - API key 은닉
 * - Origin allowlist 기반 CORS
 * - Origin/IP 기반 rate limit
 * - Gemini 응답 JSON 정규화
 */
import { getSystemPromptForCharacter, isSupportedCharacterId } from './prompts.js';
import { buildHeaders, checkRateLimit, getClientKey, isOriginAllowed } from './modules/http-policy.js';
import { createHash } from 'node:crypto';
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
    getChatRuntimeLimits,
    getClientRequestDedupeConfig,
    getRateLimitConfig,
    getRequestBodyLimitBytes,
    getDailyChatLimit,
    shouldRequireJsonContentType,
} from './modules/runtime-config.js';
import { logServerError, logServerWarn } from './modules/server-logger.js';
import { toSafeErrorMeta } from './modules/safe-error-meta.js';
import {
    buildRequestDedupeFingerprint,
    buildRequestDedupeKey,
    withRequestDedupe,
} from './modules/request-dedupe.js';
import { resolveAuthenticatedUser } from './modules/auth-guard.js';
import { GEMINI_CHAT_MODEL_NAME } from './modules/gemini-model.js';
import * as persistentStore from './platform/supabase-platform-repository.js';
import {
    guardConfidentialPromptResponse,
    isConfidentialPromptExtractionRequest,
} from './platform/prompt-builder.js';

const guardLegacyPromptPayload = ({ message, promptSnapshot }) =>
    guardConfidentialPromptResponse({ message, promptSnapshot });

export const handler = async (event, context) => {
    const requestStartedAt = Date.now();
    const requestTraceId = createTraceId();
    const origin = event.headers?.origin || event.headers?.Origin;
    const requestOrigin = event.headers?.['x-v-mate-request-origin'] || event.headers?.['X-V-MATE-Request-Origin'];
    const originAllowed = isOriginAllowed(origin, requestOrigin, event.headers);
    const headers = {
        ...buildHeaders(originAllowed, origin),
        'X-V-MATE-Trace-Id': requestTraceId,
        Deprecation: 'true',
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
        const requiresPersistentMutation = persistentStore.isPersistentPlatformAvailable()
            || persistentStore.isPersistentPlatformRequired();
        if (requiresPersistentMutation && !persistentStore.isPersistentMutationAvailable()) {
            return buildApiErrorResult({
                statusCode: 503,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: '응답 기능을 지금 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
                errorCode: 'FEATURE_TEMPORARILY_UNAVAILABLE',
                traceId: requestTraceId,
                retryable: true,
            });
        }
        const authResult = await resolveAuthenticatedUser({
            event,
            requestTraceId,
            forceAuth: requiresPersistentMutation,
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
                statusCode: 503,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: '응답 기능을 지금 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
                errorCode: 'FEATURE_TEMPORARILY_UNAVAILABLE',
                retryable: true,
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
        const promptExtractionRequested = [
            userMessage,
            ...(Array.isArray(messageHistory) ? messageHistory.map((message) => message?.content) : []),
        ].some(isConfidentialPromptExtractionRequest);
        if (promptExtractionRequested) {
            return buildApiErrorResult({
                statusCode: 400,
                headers: rateLimitedHeaders,
                startedAtMs: requestStartedAt,
                error: '비공개 설정은 요청할 수 없습니다. 캐릭터와 이어갈 대화를 입력해주세요.',
                errorCode: 'PROMPT_DISCLOSURE_REQUEST_BLOCKED',
                traceId: requestTraceId,
            });
        }
        const trimmedSystemPrompt = String(getSystemPromptForCharacter(normalizedCharacterId) || '').trim();
        if (clientRequestId) {
            headers['X-V-MATE-Client-Request-Id'] = clientRequestId;
            rateLimitedHeaders = withRateLimitHeaders(headers, rateStatus, rateLimitMaxRequests);
        }
        const logMeta = {
            traceId: requestTraceId,
            hasAuthenticatedUser: Boolean(authenticatedUserId),
        };
        const chatRuntimeLimits = getChatRuntimeLimits();

        const executeModelAndNormalize = async () => {
            const geminiResult = await executeGeminiChatRequest({
                apiKey,
                modelName: GEMINI_CHAT_MODEL_NAME,
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
                logServerWarn('[V-MATE] Response generation failed', {
                    ...logMeta,
                    ...toSafeErrorMeta(geminiResult.error),
                    elapsedMs: Math.max(0, Date.now() - requestStartedAt),
                });

                return {
                    ok: false,
                    statusCode: geminiResult.error?.status || 503,
                    error: '응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.',
                    errorCode: geminiResult.error?.status === 429 ? 'RESPONSE_RATE_LIMITED' : 'RESPONSE_SERVICE_UNAVAILABLE',
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
                promptSnapshotLength: trimmedSystemPrompt.length,
                historyMessageCount: Array.isArray(messageHistory) ? messageHistory.length : 0,
                outputLimit: chatRuntimeLimits.primaryMaxOutputTokens,
                hasFinishReason: Boolean(geminiData?.candidates?.[0]?.finishReason),
                hasPromptBlockReason: Boolean(geminiData?.promptFeedback?.blockReason),
            });
            const isFormatFallback =
                normalizedPayload.response === '잠시 응답 형식이 불안정했어요. 한 번만 다시 말해줘.' &&
                normalizedPayload.inner_heart === '';
            if (isFormatFallback) {
                logServerWarn('[V-MATE] Returning hard error for format fallback payload', {
                    ...logMeta,
                    promptSnapshotLength: trimmedSystemPrompt.length,
                    historyMessageCount: Array.isArray(messageHistory) ? messageHistory.length : 0,
                    outputLimit: chatRuntimeLimits.primaryMaxOutputTokens,
                    hasFinishReason: Boolean(geminiData?.candidates?.[0]?.finishReason),
                    hasPromptBlockReason: Boolean(geminiData?.promptFeedback?.blockReason),
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
                    error: '응답 형식을 확인하지 못했습니다. 다시 시도해주세요.',
                    errorCode: 'RESPONSE_INVALID_FORMAT',
                };
            }
            const guardedPayload = guardLegacyPromptPayload({
                message: normalizedPayload,
                promptSnapshot: trimmedSystemPrompt,
            });
            if (guardedPayload.blocked) {
                logServerWarn('[V-MATE] Confidential prompt disclosure blocked from legacy model response', logMeta);
            }
            const finalPayload = guardedPayload.message;

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
        const dedupeFingerprint = buildRequestDedupeFingerprint({
            normalizedCharacterId,
            userMessage,
            messageHistory,
            cachedContent,
        });
        const requestFingerprint = createHash('sha256')
            .update(JSON.stringify({ route: 'legacy', apiVersion: requestApiVersion, fingerprint: dedupeFingerprint }))
            .digest('hex');
        const requestDedupeKey = buildRequestDedupeKey({
            rateKey: requestScopeKey,
            clientRequestId,
            requestFingerprint,
        });
        const usePersistentQuota = persistentStore.isPersistentPlatformAvailable();
        const quotaRequestId = `legacy:${clientRequestId || requestTraceId}`;
        const dailyLimit = getDailyChatLimit();
        let quota = null;
        let modelResult = null;
        if (usePersistentQuota) {
            quota = await persistentStore.reserveChatQuota({
                userId: authenticatedUserId,
                route: 'legacy',
                roomId: null,
                requestId: quotaRequestId,
                requestFingerprint,
                limit: dailyLimit,
            });
            if (quota.disposition === 'conflict') {
                return buildApiErrorResult({
                    statusCode: 409,
                    headers: rateLimitedHeaders,
                    startedAtMs: requestStartedAt,
                    error: '같은 요청 ID에 다른 메시지가 사용되었습니다.',
                    errorCode: 'CLIENT_REQUEST_ID_CONFLICT',
                    traceId: requestTraceId,
                });
            }
            if (quota.disposition === 'in_progress') {
                return buildApiErrorResult({
                    statusCode: 409,
                    headers: rateLimitedHeaders,
                    startedAtMs: requestStartedAt,
                    error: '같은 메시지 요청을 처리하고 있습니다. 잠시 후 다시 시도해주세요.',
                    errorCode: 'CHAT_REQUEST_IN_PROGRESS',
                    traceId: requestTraceId,
                    retryable: true,
                    details: { quota: { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt } },
                });
            }
            if (quota.disposition === 'replay' && quota.response?.modelResult?.ok) {
                modelResult = quota.response.modelResult;
                headers['X-V-MATE-Dedupe-Status'] = 'replay';
                rateLimitedHeaders = withRateLimitHeaders(headers, rateStatus, rateLimitMaxRequests);
            } else if (!quota.allowed || quota.disposition === 'limit_exceeded') {
                return buildApiErrorResult({
                    statusCode: 429,
                    headers: rateLimitedHeaders,
                    startedAtMs: requestStartedAt,
                    error: '오늘의 무료 메시지를 모두 사용했습니다.',
                    errorCode: 'CHAT_DAILY_LIMIT_EXCEEDED',
                    traceId: requestTraceId,
                    details: { quota: { limit: quota.limit || dailyLimit, remaining: 0, resetAt: quota.resetAt } },
                });
            }
        }

        if (!modelResult) {
            let dedupeResult;
            try {
                dedupeResult = await withRequestDedupe({
                    dedupeKey: requestDedupeKey,
                    windowMs: dedupeConfig.windowMs,
                    maxEntries: dedupeConfig.maxEntries,
                    shouldReplayResult: (value) => Boolean(value?.ok),
                    run: executeModelAndNormalize,
                });
            } catch (error) {
                if (usePersistentQuota) {
                    await persistentStore.refundChatQuota({ userId: authenticatedUserId, requestId: quotaRequestId, requestFingerprint, limit: dailyLimit }).catch(() => null);
                }
                throw error;
            }
            if (dedupeResult?.status) {
                headers['X-V-MATE-Dedupe-Status'] = dedupeResult.status;
                rateLimitedHeaders = withRateLimitHeaders(headers, rateStatus, rateLimitMaxRequests);
            }
            modelResult = dedupeResult.value;
        }
        if (!modelResult?.ok) {
            if (usePersistentQuota) {
                await persistentStore.refundChatQuota({ userId: authenticatedUserId, requestId: quotaRequestId, requestFingerprint, limit: dailyLimit }).catch(() => null);
            }
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

        // Re-check the final boundary so persistent quota and in-process
        // dedupe replay paths cannot bypass the confidentiality guard.
        const guardedFinalPayload = guardLegacyPromptPayload({
            message: modelResult.payload,
            promptSnapshot: trimmedSystemPrompt,
        });
        if (guardedFinalPayload.blocked) {
            logServerWarn('[V-MATE] Confidential prompt disclosure blocked from legacy replay', {
                ...logMeta,
                wasPersistentReplay: quota?.disposition === 'replay',
            });
        }
        modelResult = {
            ...modelResult,
            payload: guardedFinalPayload.message,
        };

        if (usePersistentQuota && quota?.disposition !== 'replay') {
            try {
                await persistentStore.completeChatQuota({
                    userId: authenticatedUserId,
                    requestId: quotaRequestId,
                    requestFingerprint,
                    response: { modelResult },
                });
            } catch (error) {
                await persistentStore.refundChatQuota({ userId: authenticatedUserId, requestId: quotaRequestId, requestFingerprint, limit: dailyLimit }).catch(() => null);
                throw error;
            }
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
            ...toSafeErrorMeta(error),
        });

        return buildApiErrorResult({
            statusCode: 500,
            headers: rateLimitedHeaders,
            startedAtMs: requestStartedAt,
            error: 'Internal server error. Please try again later.',
            errorCode: 'INTERNAL_SERVER_ERROR',
            traceId: requestTraceId,
        });
    }
};
