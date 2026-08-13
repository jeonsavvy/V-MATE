import { createHash } from 'node:crypto';
import { buildApiErrorResult, buildJsonResult } from '../modules/http-response.js';
import { getChatRuntimeLimits, getDailyChatLimit, getGeminiThinkingLevel } from '../modules/runtime-config.js';
import { hasAuthorizationHeader, resolveAuthenticatedUser } from '../modules/auth-guard.js';
import { executeChatTurn } from '../modules/chat-turn-service.js';
import { GEMINI_CHAT_MODEL_NAME } from '../modules/gemini-model.js';
import { toSafeErrorMeta } from '../modules/safe-error-meta.js';
import { logServerWarn } from '../modules/server-logger.js';
import * as memoryStore from './content-store.js';
import * as persistentStore from './supabase-platform-repository.js';
import {
  validateContentAssetReferences,
  validateContentPayload,
  validateUploadVariants,
} from './input-contracts.js';
import {
  guardConfidentialPromptResponse,
  isConfidentialPromptExtractionRequest,
} from './prompt-builder.js';
import { resolvePlatformRoute } from './route-policy.js';

// 플랫폼 라우터는 public read, authenticated write, owner ops를 하나의 계약으로 묶는다.
const PLATFORM_ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

// Supabase가 준비되면 persistent store를, 로컬 개발에서만 memory store를 선택한다.
const getPlatformStore = (runtimeEnvironment = process.env) => (
  persistentStore.isPersistentPlatformAvailable(runtimeEnvironment) ? persistentStore : memoryStore
);

const PUBLIC_CONTENT_SUMMARY_KEYS = Object.freeze([
  'id',
  'entityType',
  'slug',
  'name',
  'headline',
  'summary',
  'coverImageUrl',
  'avatarImageUrl',
  'tags',
  'creator',
  'visibility',
  'displayStatus',
  'sourceType',
  'sourceUrl',
  'rightsAttestedAt',
  'moderationStatus',
  'favoriteCount',
  'chatStartCount',
  'updatedAt',
  'heroImageUrl',
  'imageSlots',
]);
const PUBLIC_CONTENT_STRING_KEYS = new Set([
  'id', 'entityType', 'slug', 'name', 'headline', 'summary',
  'coverImageUrl', 'avatarImageUrl', 'visibility', 'displayStatus',
  'sourceType', 'sourceUrl', 'rightsAttestedAt', 'moderationStatus',
  'updatedAt', 'heroImageUrl',
]);
const PUBLIC_CONTENT_NUMBER_KEYS = new Set(['favoriteCount', 'chatStartCount']);

const toPublicCreator = (creator = {}) => ({
  id: String(creator.id || ''),
  slug: String(creator.slug || ''),
  name: String(creator.name || ''),
  ...(typeof creator.bio === 'string' && creator.bio ? { bio: creator.bio } : {}),
});

const toPublicImageSlot = (slot = {}) => ({
  id: String(slot.id || ''),
  slot: String(slot.slot || ''),
  ...(typeof slot.thumbUrl === 'string' && slot.thumbUrl ? { thumbUrl: slot.thumbUrl } : {}),
  ...(typeof slot.feedUrl === 'string' && slot.feedUrl ? { feedUrl: slot.feedUrl } : {}),
  ...(Number.isFinite(Number(slot.feedWidth)) && Number(slot.feedWidth) > 0 ? { feedWidth: Number(slot.feedWidth) } : {}),
  ...(typeof slot.cardUrl === 'string' && slot.cardUrl ? { cardUrl: slot.cardUrl } : {}),
  ...(typeof slot.detailUrl === 'string' && slot.detailUrl ? { detailUrl: slot.detailUrl } : {}),
});

const toPublicSection = (section = {}) => ({
  title: String(section.title || ''),
  body: String(section.body || ''),
});

// Public API DTOs are allowlisted so future authoring fields cannot silently
// become public merely because a store starts returning them.
export const toPublicContentSummary = (item = {}) => {
  const summary = Object.fromEntries(
    PUBLIC_CONTENT_SUMMARY_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(item, key))
      .map((key) => {
        if (PUBLIC_CONTENT_STRING_KEYS.has(key)) {
          return [key, typeof item[key] === 'string' ? item[key] : ''];
        }
        if (PUBLIC_CONTENT_NUMBER_KEYS.has(key)) {
          return [key, Number.isFinite(Number(item[key])) ? Number(item[key]) : 0];
        }
        return [key, item[key]];
      })
  );
  if (Object.prototype.hasOwnProperty.call(summary, 'creator')) {
    summary.creator = toPublicCreator(summary.creator);
  }
  if (Object.prototype.hasOwnProperty.call(summary, 'imageSlots')) {
    summary.imageSlots = Array.isArray(summary.imageSlots)
      ? summary.imageSlots.slice(0, 6).map(toPublicImageSlot)
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(summary, 'tags')) {
    summary.tags = Array.isArray(summary.tags) ? summary.tags.map((tag) => String(tag)) : [];
  }
  return summary;
};

export const toPublicContentDetail = (item = {}) => {
  const summary = toPublicContentSummary(item);
  if (item.entityType === 'world') {
    return {
      ...summary,
      worldSections: Array.isArray(item.worldSections) ? item.worldSections.map(toPublicSection) : [],
      gallery: Array.isArray(item.gallery) ? item.gallery.map((url) => String(url)) : [],
      characters: Array.isArray(item.characters) ? item.characters.map(toPublicContentSummary) : [],
    };
  }
  return {
    ...summary,
    profileSections: Array.isArray(item.profileSections) ? item.profileSections.map(toPublicSection) : [],
    gallery: Array.isArray(item.gallery) ? item.gallery.map((url) => String(url)) : [],
  };
};

const toPublicHomePayload = (payload) => {
  if (!payload?.home) return payload;
  return {
    ...payload,
    home: {
      ...payload.home,
      characterFeed: {
        ...payload.home.characterFeed,
        items: (payload.home.characterFeed?.items || []).map(toPublicContentSummary),
      },
      worldFeed: {
        ...payload.home.worldFeed,
        items: (payload.home.worldFeed?.items || []).map(toPublicContentSummary),
      },
    },
  };
};

const withPlatformHeaders = (headers) => ({
  ...headers,
  'Access-Control-Allow-Methods': PLATFORM_ALLOWED_METHODS,
});

const jsonOk = ({ statusCode = 200, headers, startedAtMs, body }) => buildJsonResult({
  statusCode,
  headers: withPlatformHeaders(headers),
  startedAtMs,
  body,
});

const jsonError = ({ statusCode, headers, startedAtMs, traceId, error, errorCode, retryable = false, details }) => buildApiErrorResult({
  statusCode,
  headers: withPlatformHeaders(headers),
  startedAtMs,
  traceId,
  error,
  errorCode,
  retryable,
  details,
});

const parseJsonBody = (bodyText) => {
  if (!bodyText) return {};
  try {
    const parsed = JSON.parse(String(bodyText));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return null;
  }
};

const CATALOG_SEARCH_LIMIT = 160;
const parseBooleanQuery = (value, fallback = true) => {
  if (typeof value === 'undefined' || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'no'].includes(normalized)) return false;
  if (['true', '1', 'yes'].includes(normalized)) return true;
  return fallback;
};
const parseQuery = (queryStringParameters = {}) => ({
  search: String(queryStringParameters.search || '').trim().slice(0, CATALOG_SEARCH_LIMIT),
  filter: String(queryStringParameters.filter || '').trim(),
  characterFilter: String(queryStringParameters.characterFilter || queryStringParameters.character_filter || queryStringParameters.filter || '').trim(),
  worldFilter: String(queryStringParameters.worldFilter || queryStringParameters.world_filter || queryStringParameters.filter || '').trim(),
  tab: String(queryStringParameters.tab || 'characters').trim(),
  tag: String(queryStringParameters.tag || '').trim(),
  limit: queryStringParameters.limit,
  includeMessages: parseBooleanQuery(queryStringParameters.includeMessages ?? queryStringParameters.include_messages, true),
  includeRecentRooms: parseBooleanQuery(queryStringParameters.includeRecentRooms ?? queryStringParameters.include_recent_rooms, true),
});

export const resolveViewerBookmarked = async ({ store, event, userId, entityType, targetId }) => {
  if (!userId || !targetId || typeof store?.getBookmarkStatus !== 'function') return false;
  try {
    return Boolean(await store.getBookmarkStatus({ event, userId, entityType, targetId }));
  } catch (error) {
    logServerWarn('[V-MATE] Bookmark status read failed; returning unavailable state', {
      ...toSafeErrorMeta(error),
    });
    return null;
  }
};

const resolveOptionalUser = async ({ event, traceId, requireAuth = false, allowLocalDemo = false, runtimeEnvironment = event?.runtimeEnvironment || process.env }) => {
  if (!requireAuth && !hasAuthorizationHeader(event?.headers)) {
    const canUseLocalDemo = allowLocalDemo
      && !persistentStore.isPersistentPlatformAvailable(runtimeEnvironment)
      && !persistentStore.isPersistentPlatformRequired(runtimeEnvironment);
    return { ok: true, userId: canUseLocalDemo ? 'demo-user' : '' };
  }
  return resolveAuthenticatedUser({ event, requestTraceId: traceId, forceAuth: true, runtimeEnvironment });
};

const resolveRouteUser = async ({ route, event, traceId, runtimeEnvironment }) => {
  const authMode = route.policy.auth;
  if (authMode === 'public') return { ok: true, userId: '' };
  if (authMode === 'optional') return resolveOptionalUser({ event, traceId, runtimeEnvironment });
  if (authMode === 'required') return resolveOptionalUser({ event, traceId, requireAuth: true, runtimeEnvironment });
  return resolveOptionalUser({
    event,
    traceId,
    requireAuth: persistentStore.isPersistentPlatformAvailable(runtimeEnvironment),
    allowLocalDemo: true,
    runtimeEnvironment,
  });
};

const REPORT_REASONS = new Set(['sexual_content', 'minor_safety', 'hate_or_harassment', 'copyright', 'spam', 'other']);

const buildRequestFingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const mutationUnavailableError = ({ headers, startedAtMs, traceId }) => jsonError({
  statusCode: 503,
  headers,
  startedAtMs,
  traceId,
  error: '요청한 기능을 지금 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
  errorCode: 'FEATURE_TEMPORARILY_UNAVAILABLE',
  retryable: true,
});

const ensureRequiredPersistenceAvailable = ({ headers, startedAtMs, traceId, runtimeEnvironment }) => (
  persistentStore.isPersistentPlatformRequired(runtimeEnvironment) && !persistentStore.isPersistentPlatformAvailable(runtimeEnvironment)
    ? mutationUnavailableError({ headers, startedAtMs, traceId })
    : null
);

const ensurePersistentMutationAvailable = ({ headers, startedAtMs, traceId, runtimeEnvironment }) => (
  (persistentStore.isPersistentPlatformAvailable(runtimeEnvironment) || persistentStore.isPersistentPlatformRequired(runtimeEnvironment))
    && !persistentStore.isPersistentMutationAvailable(runtimeEnvironment)
    ? mutationUnavailableError({ headers, startedAtMs, traceId })
    : null
);

const toContentValidationError = ({ validation, headers, startedAtMs, traceId }) => jsonError({
  statusCode: 400,
  headers,
  startedAtMs,
  traceId,
  error: validation.error,
  errorCode: validation.errorCode,
  details: validation.details,
});

const validateContentRequest = async ({ event, userId, entityType, body, mode, slug }) => {
  const runtimeEnvironment = event?.runtimeEnvironment || process.env;
  const store = getPlatformStore(runtimeEnvironment);
  const existing = mode === 'patch'
    ? await (entityType === 'character'
      ? store.getCharacterDetail({ event, slug, userId })
      : store.getWorldDetail({ event, slug, userId }))
    : null;
  if (mode === 'patch' && (!existing || String(existing.creator?.id || '') !== String(userId || ''))) {
    return { ok: false, notFound: true };
  }
  const normalized = validateContentPayload({ entityType, payload: body, mode, existing });
  if (!normalized.ok) return normalized;
  const config = persistentStore.getPlatformPersistenceConfig(runtimeEnvironment);
  const references = validateContentAssetReferences({
    payload: normalized.value,
    existingPayload: existing,
    userId,
    entityType,
    supabaseUrl: config.supabaseUrl,
    bucket: config.storageBucket,
    enforceCanonical: persistentStore.isPersistentPlatformAvailable(runtimeEnvironment),
  });
  if (!references.ok) return references;
  return { ok: true, value: normalized.value, existing };
};

export const mapStoreError = ({ error, headers, startedAtMs, traceId }) => {
  const code = String(error?.code || error?.message || '');
  if (code.includes('ACCOUNT_DELETE_IN_PROGRESS')) {
    return jsonError({
      statusCode: 409,
      headers,
      startedAtMs,
      traceId,
      error: '계정 삭제가 진행 중이어서 새 업로드를 시작하지 않았습니다.',
      errorCode: 'ACCOUNT_DELETE_IN_PROGRESS',
    });
  }
  if (code.includes('ASSET_UPLOAD_STATE_UNKNOWN')) {
    return jsonError({
      statusCode: 503,
      headers,
      startedAtMs,
      traceId,
      error: '업로드 가능 상태를 확인하지 못했습니다. 현재 데이터는 유지되며 잠시 후 다시 시도해주세요.',
      errorCode: 'ASSET_UPLOAD_STATE_UNKNOWN',
      retryable: true,
    });
  }
  if (code.includes('CONTENT_DELETE_STATE_UNKNOWN')) {
    return jsonError({
      statusCode: 503,
      headers,
      startedAtMs,
      traceId,
      error: '삭제 결과를 확인하지 못했습니다. 목록을 다시 불러와 현재 상태를 확인해주세요.',
      errorCode: 'CONTENT_DELETE_STATE_UNKNOWN',
      retryable: true,
    });
  }
  if (code.includes('OPS_DASHBOARD_UNAVAILABLE')) {
    return jsonError({
      statusCode: 503,
      headers,
      startedAtMs,
      traceId,
      error: '운영 데이터를 확인하지 못했습니다. 현재 화면의 데이터는 갱신되지 않았습니다. 잠시 후 다시 불러와 주세요.',
      errorCode: 'OPS_DASHBOARD_UNAVAILABLE',
      retryable: true,
    });
  }
  if (code.includes('ROOM_TARGET_NOT_STARTABLE')) {
    return jsonError({ statusCode: 409, headers, startedAtMs, traceId, error: '선택한 콘텐츠로는 대화를 시작할 수 없습니다.', errorCode: 'ROOM_TARGET_NOT_STARTABLE' });
  }
  if (code.includes('ROOM_TARGET_NOT_FOUND')) {
    return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: '선택한 콘텐츠를 찾을 수 없습니다.', errorCode: 'ROOM_TARGET_NOT_FOUND' });
  }
  if (code.includes('CHAT_REQUEST_CONFLICT') || code.includes('CLIENT_REQUEST_ID_CONFLICT')) {
    return jsonError({ statusCode: 409, headers, startedAtMs, traceId, error: '같은 요청 ID에 다른 메시지가 사용되었습니다.', errorCode: 'CLIENT_REQUEST_ID_CONFLICT' });
  }
  if (code.includes('CHAT_ROOM_VERSION_CONFLICT') || code.includes('CHAT_RESERVATION_EXPIRED')) {
    return jsonError({ statusCode: 409, headers, startedAtMs, traceId, error: '대화 상태가 변경되었습니다. 최신 상태에서 다시 시도해주세요.', errorCode: 'CHAT_STATE_CONFLICT', retryable: true });
  }
  return null;
};

// 외부 모델 호출은 DB 트랜잭션 밖에서 실행하되, quota lease와 room commit은 서버 전용 RPC로 묶는다.
export const handleRoomChat = async ({
  event,
  headers,
  startedAtMs,
  traceId,
  roomId,
  storeOverride = null,
  authenticatedUserId = undefined,
  persistencePrechecked = false,
  runtimeConfig = null,
  runtimeEnvironment = runtimeConfig?.environment || event?.runtimeEnvironment || process.env,
}) => {
  if (event?.runtimeEnvironment !== runtimeEnvironment) {
    event = { ...event, runtimeEnvironment };
  }
  const authResult = typeof authenticatedUserId === 'string'
    ? { ok: true, userId: authenticatedUserId }
    : await resolveOptionalUser({
      event,
      traceId,
      requireAuth: persistentStore.isPersistentPlatformAvailable(runtimeEnvironment),
      allowLocalDemo: true,
      runtimeEnvironment,
    });
  if (!authResult.ok) {
    return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || '로그인이 필요합니다.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
  }
  if (!persistencePrechecked) {
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId, runtimeEnvironment });
    if (unavailable) return unavailable;
  }

  const store = storeOverride || getPlatformStore(runtimeEnvironment);
  const room = await store.getRoom({ event, roomId, userId: authResult.userId });
  if (!room) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: '대화방을 찾을 수 없습니다.', errorCode: 'ROOM_NOT_FOUND' });

  const body = parseJsonBody(event.body);
  if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
  const userMessage = String(body.userMessage || '').trim();
  if (!userMessage || userMessage.length > 12000) {
    return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '메시지는 1자 이상 12,000자 이하로 입력해주세요.', errorCode: 'INVALID_USER_MESSAGE' });
  }
  const clientRequestId = String(body.clientRequestId || '').trim();
  if (clientRequestId && !/^[A-Za-z0-9_-]{8,128}$/.test(clientRequestId)) {
    return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 ID 형식을 확인해주세요.', errorCode: 'INVALID_CLIENT_REQUEST_ID' });
  }
  if (isConfidentialPromptExtractionRequest(userMessage)) {
    return jsonError({
      statusCode: 400,
      headers,
      startedAtMs,
      traceId,
      error: '비공개 설정은 요청할 수 없습니다. 캐릭터와 이어갈 장면이나 대화를 입력해주세요.',
      errorCode: 'PROMPT_DISCLOSURE_REQUEST_BLOCKED',
    });
  }
  const apiKey = runtimeEnvironment?.GOOGLE_API_KEY;
  if (!apiKey) return mutationUnavailableError({ headers, startedAtMs, traceId });

  const chatRuntimeLimits = runtimeConfig?.chatRuntimeLimits || getChatRuntimeLimits(runtimeEnvironment);
  const dailyLimit = runtimeConfig?.dailyChatLimit || getDailyChatLimit(runtimeEnvironment);
  const quotaRequestId = `room:${roomId}:${clientRequestId || traceId}`;
  const requestFingerprint = buildRequestFingerprint({ route: 'room', roomId, character: room.character.slug, userMessage });
  const quota = await store.reserveChatQuota({
    event,
    userId: authResult.userId,
    route: 'room',
    roomId,
    requestId: quotaRequestId,
    requestFingerprint,
    limit: dailyLimit,
  });
  if (quota?.disposition === 'conflict') {
    return jsonError({ statusCode: 409, headers, startedAtMs, traceId, error: '같은 요청 ID에 다른 메시지가 사용되었습니다.', errorCode: 'CLIENT_REQUEST_ID_CONFLICT' });
  }
  if (quota?.disposition === 'replay' && quota.response?.message) {
    let currentRoom;
    let replayPromptContext;
    try {
      [currentRoom, replayPromptContext] = await Promise.all([
        store.getRoom({ event, roomId, userId: authResult.userId }),
        store.getRoomPromptContext({ event, roomId, userId: authResult.userId }),
      ]);
    } catch {
      return jsonError({
        statusCode: 503,
        headers,
        startedAtMs,
        traceId,
        error: '저장된 응답을 안전하게 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
        errorCode: 'PROMPT_CONTEXT_UNAVAILABLE',
        retryable: true,
      });
    }
    if (!replayPromptContext?.promptSnapshot) {
      return jsonError({
        statusCode: 503,
        headers,
        startedAtMs,
        traceId,
        error: '저장된 응답을 안전하게 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
        errorCode: 'PROMPT_CONTEXT_UNAVAILABLE',
        retryable: true,
      });
    }
    const guardedReplay = guardConfidentialPromptResponse({
      message: quota.response.message,
      promptSnapshot: replayPromptContext?.promptSnapshot,
    });
    if (guardedReplay.blocked) {
      logServerWarn('[V-MATE] Confidential prompt disclosure blocked from replay', { traceId });
    }
    return jsonOk({
      headers,
      startedAtMs,
      body: {
        room: currentRoom || room,
        message: guardedReplay.message,
        trace_id: quota.response.trace_id || traceId,
        quota: { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt },
        thinking_level: runtimeConfig?.geminiThinkingLevel || getGeminiThinkingLevel(runtimeEnvironment),
        history_window: chatRuntimeLimits.maxHistoryMessages,
      },
    });
  }
  if (quota?.disposition === 'in_progress' || quota?.duplicate) {
    return jsonError({
      statusCode: 409,
      headers,
      startedAtMs,
      traceId,
      error: '같은 메시지 요청을 처리하고 있습니다. 잠시 후 다시 시도해주세요.',
      errorCode: 'CHAT_REQUEST_IN_PROGRESS',
      retryable: true,
      details: { quota: { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt } },
    });
  }
  if (!quota?.allowed || quota?.disposition === 'limit_exceeded') {
    return jsonError({
      statusCode: 429,
      headers,
      startedAtMs,
      traceId,
      error: '오늘의 무료 메시지를 모두 사용했습니다.',
      errorCode: 'CHAT_DAILY_LIMIT_EXCEEDED',
      details: { quota: { limit: quota?.limit || dailyLimit, remaining: 0, resetAt: quota?.resetAt } },
    });
  }

  const refund = async () => store.refundChatQuota({
    event,
    userId: authResult.userId,
    requestId: quotaRequestId,
    requestFingerprint,
    limit: dailyLimit,
  });
  const refundBestEffort = async () => refund().catch(() => null);
  try {
    const promptContext = await store.getRoomPromptContext({ event, roomId, userId: authResult.userId });
    const roomHistory = await store.getRoomHistoryForModel({ event, roomId, userId: authResult.userId });
    if (!promptContext) {
      await refundBestEffort();
      return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: '대화방을 찾을 수 없습니다.', errorCode: 'ROOM_NOT_FOUND' });
    }

    const result = await executeChatTurn({
      modelRequest: {
        apiKey,
        modelName: GEMINI_CHAT_MODEL_NAME,
        requestStartedAt: startedAtMs,
        requestTraceId: traceId,
        normalizedCharacterId: room.character.slug,
        userMessage,
        messageHistory: roomHistory,
        requestCachedContent: null,
        trimmedSystemPrompt: promptContext.promptSnapshot,
        promptCacheAdapter: null,
        runtimeConfig,
        runtimeEnvironment,
      },
      promptSnapshot: promptContext.promptSnapshot,
    });
    if (!result.ok) {
      await refundBestEffort();
      return jsonError({
        statusCode: result.failure.statusCode,
        headers,
        startedAtMs,
        traceId,
        error: result.failure.error,
        errorCode: result.failure.errorCode,
        retryable: result.failure.retryable,
      });
    }

    if (result.disclosureBlocked) {
      logServerWarn('[V-MATE] Confidential prompt disclosure blocked from model response', { traceId });
    }
    const message = result.value;
    let nextRoom;
    if (typeof store.commitRoomTurn === 'function') {
      nextRoom = await store.commitRoomTurn({
        event,
        userId: authResult.userId,
        roomId,
        requestId: quotaRequestId,
        requestFingerprint,
        expectedVersion: quota.roomVersion ?? room.version ?? 0,
        userMessage,
        assistantMessage: message,
        response: { message, trace_id: traceId },
        room,
        promptContext,
      });
    } else {
      nextRoom = await store.appendRoomMessages({ event, userId: authResult.userId, roomId, userMessage, assistantMessage: message });
      await store.completeChatQuota?.({ event, userId: authResult.userId, requestId: quotaRequestId, requestFingerprint, response: { message, trace_id: traceId } });
    }

    return jsonOk({
      headers,
      startedAtMs,
      body: {
        room: nextRoom,
        message,
        trace_id: traceId,
        quota: { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt },
        thinking_level: runtimeConfig?.geminiThinkingLevel || getGeminiThinkingLevel(runtimeEnvironment),
        history_window: chatRuntimeLimits.maxHistoryMessages,
      },
    });
  } catch (error) {
    await refundBestEffort();
    const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
    if (mapped) return mapped;
    throw error;
  }
};

export const handlePlatformApi = async ({
  event,
  headers,
  startedAtMs,
  traceId,
  runtimeConfig = null,
  runtimeEnvironment = runtimeConfig?.environment || event?.runtimeEnvironment || process.env,
}) => {
  if (event?.runtimeEnvironment !== runtimeEnvironment) {
    event = { ...event, runtimeEnvironment };
  }
  const path = String(event.path || '/');
  const method = String(event.httpMethod || 'GET').toUpperCase();
  const store = getPlatformStore(runtimeEnvironment);

  if (method === 'OPTIONS') {
    return jsonOk({ statusCode: 200, headers, startedAtMs, body: '' });
  }

  const matchedRoute = resolvePlatformRoute({ method, path });
  if (!matchedRoute) {
    return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Not found.', errorCode: 'NOT_FOUND' });
  }
  const { definition: route, params } = matchedRoute;
  const routeId = route.id;

  // Production-like runtimes must never downgrade reads or writes to demo fixtures.
  const persistenceUnavailable = ensureRequiredPersistenceAvailable({ headers, startedAtMs, traceId, runtimeEnvironment });
  if (persistenceUnavailable) return persistenceUnavailable;

  if (route.policy.mutation) {
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId, runtimeEnvironment });
    if (unavailable) return unavailable;
  }

  const authResult = await resolveRouteUser({ route, event, traceId, runtimeEnvironment });
  if (!authResult.ok) {
    return jsonError({
      statusCode: authResult.statusCode || 401,
      headers,
      startedAtMs,
      traceId,
      error: authResult.error || 'Authentication required.',
      errorCode: authResult.errorCode || 'AUTH_REQUIRED',
      retryable: Boolean(authResult.retryable),
    });
  }
  const userId = String(authResult.userId || '');
  if (route.policy.owner && !await store.isOwnerUser?.({ event, userId })) {
    return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
  }

  // 공개 탐색 라우트
  if (routeId === 'home') {
    const query = parseQuery(event.queryStringParameters);
    const payload = await store.getHomePayload({
      event,
      runtimeEnvironment,
      tab: query.tab,
      search: query.search,
      filter: query.filter,
      characterFilter: query.characterFilter,
      worldFilter: query.worldFilter,
    });
    return jsonOk({ headers, startedAtMs, body: toPublicHomePayload(payload) });
  }

  if (routeId === 'character-list') {
    const query = parseQuery(event.queryStringParameters);
    const items = await store.listCharacters({ event, runtimeEnvironment, search: query.search, filter: query.filter });
    return jsonOk({ headers, startedAtMs, body: { items: items.map(toPublicContentSummary) } });
  }

  if (routeId === 'world-list') {
    const query = parseQuery(event.queryStringParameters);
    const items = await store.listWorlds({ event, runtimeEnvironment, search: query.search, filter: query.filter });
    return jsonOk({ headers, startedAtMs, body: { items: items.map(toPublicContentSummary) } });
  }

  if (routeId === 'character-detail') {
    const item = await store.getCharacterDetail({ event, slug: params.slug, userId });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    const isOwner = Boolean(userId) && String(item.creator?.id || '') === userId;
    const bookmarked = await resolveViewerBookmarked({ store, event, userId, entityType: 'character', targetId: item.id });
    return jsonOk({ headers, startedAtMs, body: { item: isOwner ? item : toPublicContentDetail(item), viewer: { bookmarked } } });
  }

  if (routeId === 'world-detail') {
    const item = await store.getWorldDetail({ event, slug: params.slug, userId });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    const isOwner = Boolean(userId) && String(item.creator?.id || '') === userId;
    const bookmarked = await resolveViewerBookmarked({ store, event, userId, entityType: 'world', targetId: item.id });
    return jsonOk({ headers, startedAtMs, body: { item: isOwner ? item : toPublicContentDetail(item), viewer: { bookmarked } } });
  }

  if (routeId === 'recent-rooms') {
    const query = parseQuery(event.queryStringParameters);
    return jsonOk({ headers, startedAtMs, body: { items: await store.listRecentRooms({ event, userId, limit: query.limit, includeMessages: query.includeMessages }) } });
  }

  if (routeId === 'library') {
    const query = parseQuery(event.queryStringParameters);
    return jsonOk({ headers, startedAtMs, body: await store.getLibraryPayload({ event, userId, includeRecentRooms: query.includeRecentRooms }) });
  }

  if (routeId === 'chat-quota') {
    return jsonOk({ headers, startedAtMs, body: { quota: await store.getChatQuota({ event, userId, limit: runtimeConfig?.dailyChatLimit || getDailyChatLimit(runtimeEnvironment) }) } });
  }

  if (routeId === 'create-report') {
    const body = parseJsonBody(event.body);
    if (!body || !['character', 'world'].includes(body.entityType) || !String(body.entityId || '').trim() || !REPORT_REASONS.has(body.reason)) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid report payload.', errorCode: 'INVALID_REPORT' });
    try {
      const report = await store.createContentReport({ event, userId, payload: body });
      if (!report) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Content not found.', errorCode: 'CONTENT_NOT_FOUND' });
      return jsonOk({ statusCode: 201, headers, startedAtMs, body: { report } });
    } catch (error) {
      if (error?.code === 'REPORT_ALREADY_OPEN' || error?.code === '23505') return jsonError({ statusCode: 409, headers, startedAtMs, traceId, error: '이미 검토 중인 신고가 있습니다.', errorCode: 'REPORT_ALREADY_OPEN' });
      throw error;
    }
  }

  // 로그인 사용자 데이터 라우트
  if (routeId === 'delete-account') {
    let result;
    try {
      result = await store.deleteAccount({ event, userId });
    } catch (error) {
      if (error?.code === 'ACCOUNT_DELETE_STORAGE_STATE_UNKNOWN') {
        return jsonError({
          statusCode: 503,
          headers,
          startedAtMs,
          traceId,
          error: '업로드 정리 상태를 확인하지 못했습니다. 계정은 유지되며, 다시 시도하면 남은 삭제를 이어갑니다.',
          errorCode: 'ACCOUNT_DELETE_STORAGE_STATE_UNKNOWN',
          retryable: true,
        });
      }
      if (error?.code === 'ACCOUNT_DELETE_PARTIAL_STORAGE_REMOVED') {
        return jsonError({
          statusCode: 503,
          headers,
          startedAtMs,
          traceId,
          error: '업로드는 정리되었지만 계정 삭제를 완료하지 못했습니다. 다시 시도해주세요.',
          errorCode: 'ACCOUNT_DELETE_PARTIAL_STORAGE_REMOVED',
          retryable: true,
        });
      }
      if (error?.code === 'ACCOUNT_DELETE_STATE_UNKNOWN') {
        return jsonError({
          statusCode: 503,
          headers,
          startedAtMs,
          traceId,
          error: '계정 삭제 상태를 확인하지 못했습니다. 다시 로그인해 상태를 확인한 뒤 재시도해주세요.',
          errorCode: 'ACCOUNT_DELETE_STATE_UNKNOWN',
          retryable: true,
        });
      }
      throw error;
    }
    if (result?.reason === 'admin_not_configured') {
      return jsonError({
        statusCode: 503,
        headers,
        startedAtMs,
        traceId,
        error: '계정 삭제 기능을 지금 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
        errorCode: 'ACCOUNT_DELETE_NOT_CONFIGURED',
        retryable: true,
      });
    }
    return jsonOk({ headers, startedAtMs, body: { ok: true, deleted: true, data: result } });
  }

  if (routeId === 'recent-view') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    await store.addRecentView({ event, userId, entityType: String(body.entityType || '').trim(), ref: body.entityRef || body.slug || body.id });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { ok: true } });
  }

  if (routeId === 'create-bookmark') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const result = await store.toggleBookmark({ event, userId, entityType: String(body.entityType || '').trim(), ref: body.entityRef || body.slug || body.id });
    if (!result) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Entity not found.', errorCode: 'ENTITY_NOT_FOUND' });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: result });
  }

  if (routeId === 'delete-bookmark') {
    await store.removeBookmark({ event, userId, bookmarkId: params.bookmarkId });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  // 제작 및 편집 라우트
  if (routeId === 'create-character') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const validation = await validateContentRequest({ event, userId, entityType: 'character', body, mode: 'create' });
    if (!validation.ok) return toContentValidationError({ validation, headers, startedAtMs, traceId });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { item: await store.createCharacter({ event, userId, payload: validation.value }) } });
  }

  if (routeId === 'update-character') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const validation = await validateContentRequest({ event, userId, entityType: 'character', body, mode: 'patch', slug: params.slug });
    if (validation.notFound) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    if (!validation.ok) return toContentValidationError({ validation, headers, startedAtMs, traceId });
    const item = await store.updateCharacter?.({ event, userId, slug: params.slug, payload: validation.value });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { item } });
  }

  if (routeId === 'delete-character') {
    let ok;
    try {
      ok = await (store.deleteOwnedContent?.({ event, userId, entityType: 'character', id: params.id })
        ?? store.deleteContent({ event, entityType: 'character', id: params.id }));
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (routeId === 'create-world') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const validation = await validateContentRequest({ event, userId, entityType: 'world', body, mode: 'create' });
    if (!validation.ok) return toContentValidationError({ validation, headers, startedAtMs, traceId });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { item: await store.createWorld({ event, userId, payload: validation.value }) } });
  }

  if (routeId === 'update-world') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const validation = await validateContentRequest({ event, userId, entityType: 'world', body, mode: 'patch', slug: params.slug });
    if (validation.notFound) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    if (!validation.ok) return toContentValidationError({ validation, headers, startedAtMs, traceId });
    const item = await store.updateWorld?.({ event, userId, slug: params.slug, payload: validation.value });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { item } });
  }

  if (routeId === 'delete-world') {
    let ok;
    try {
      ok = await (store.deleteOwnedContent?.({ event, userId, entityType: 'world', id: params.id })
        ?? store.deleteContent({ event, entityType: 'world', id: params.id }));
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (routeId === 'prepare-upload') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const entityType = String(body.entityType || '');
    const variantsValidation = validateUploadVariants({ entityType, variants: body.variants });
    if (!variantsValidation.ok) return toContentValidationError({ validation: variantsValidation, headers, startedAtMs, traceId });
    let prepared;
    try {
      prepared = await store.prepareAssetUploads({ event, userId, entityType, variants: variantsValidation.value });
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    return jsonOk({ headers, startedAtMs, body: prepared });
  }

  if (routeId === 'create-room') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const characterSlug = String(body.characterSlug || body.characterId || '').trim();
    const worldSlug = String(body.worldSlug || body.worldId || '').trim() || null;
    const userAlias = String(body.userAlias || '').trim() || '나';
    if (!characterSlug || characterSlug.length > 120 || (worldSlug && worldSlug.length > 120) || userAlias.length > 40) {
      return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '대화방 입력값을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    }
    let room;
    try {
      room = await store.createRoom({ event, userId, characterSlug, worldSlug, userAlias });
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    if (!room) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'ROOM_TARGET_NOT_FOUND' });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { room } });
  }

  if (routeId === 'get-room') {
    const room = await store.getRoom({ event, roomId: params.roomId, userId });
    if (!room) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Room not found.', errorCode: 'ROOM_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { room } });
  }

  if (routeId === 'room-chat') {
    return handleRoomChat({
      event,
      headers,
      startedAtMs,
      traceId,
      roomId: params.roomId,
      storeOverride: store,
      authenticatedUserId: userId,
      persistencePrechecked: true,
      runtimeConfig,
      runtimeEnvironment,
    });
  }

  // owner 전용 운영 라우트
  if (routeId === 'ops-reports') {
    const status = String(event.queryStringParameters?.status || 'open');
    return jsonOk({ headers, startedAtMs, body: { reports: await store.listContentReports({ event, status }) } });
  }

  if (routeId === 'ops-update-report') {
    const body = parseJsonBody(event.body);
    if (!body || !['dismiss', 'restore', 'quarantine', 'remove'].includes(body.action)) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid moderation action.', errorCode: 'INVALID_MODERATION_ACTION' });
    const result = await store.applyReportAction({ event, userId, reportId: params.reportId, action: body.action, note: String(body.note || '') });
    if (!result) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Report not found.', errorCode: 'REPORT_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: result });
  }

  if (routeId === 'ops-dashboard') {
    try {
      const dashboard = await store.getOpsDashboard({ event, userId, ownerPrechecked: true });
      if (!dashboard) {
        const error = new Error('OPS_DASHBOARD_UNAVAILABLE');
        error.code = 'OPS_DASHBOARD_UNAVAILABLE';
        throw error;
      }
      return jsonOk({ headers, startedAtMs, body: dashboard });
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
  }

  if (routeId === 'ops-content-visibility') {
    const status = params.action === 'hide' ? 'hidden' : params.action === 'show' ? 'visible' : null;
    if (!status) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Not found.', errorCode: 'NOT_FOUND' });
    const ok = await store.setContentVisibility({ event, userId, entityType: params.entityType, id: params.id, status, ownerPrechecked: true });
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Content not found.', errorCode: 'CONTENT_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (routeId === 'ops-delete-content') {
    let ok;
    try {
      ok = await store.deleteContent({ event, userId, entityType: params.entityType, id: params.id, ownerPrechecked: true });
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Content not found.', errorCode: 'CONTENT_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (routeId === 'ops-home-banner' || routeId === 'ops-home-banner-target') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    return jsonOk({ headers, startedAtMs, body: { home: await store.setHomeHeroTarget({ event, targetPath: String(body.targetPath || '') }) } });
  }

  if (routeId === 'ops-home-banner-mode') {
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    return jsonOk({ headers, startedAtMs, body: { home: await store.setHomeHeroMode({ event, mode: String(body.mode || 'auto') }) } });
  }

  return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Not found.', errorCode: 'NOT_FOUND' });
};
