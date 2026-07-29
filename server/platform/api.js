import { createHash } from 'node:crypto';
import { buildApiErrorResult, buildJsonResult } from '../modules/http-response.js';
import { getChatRuntimeLimits, getDailyChatLimit, getGeminiThinkingLevel } from '../modules/runtime-config.js';
import { hasAuthorizationHeader, resolveAuthenticatedUser } from '../modules/auth-guard.js';
import { executeGeminiChatRequest } from '../modules/gemini-orchestrator.js';
import { GEMINI_CHAT_MODEL_NAME } from '../modules/gemini-model.js';
import { normalizeAssistantPayload } from '../modules/response-normalizer.js';
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

// 플랫폼 라우터는 public read, authenticated write, owner ops를 하나의 계약으로 묶는다.
const PLATFORM_ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

// Supabase가 준비되면 persistent store를, 로컬 개발에서만 memory store를 선택한다.
const getPlatformStore = () => (persistentStore.isPersistentPlatformAvailable() ? persistentStore : memoryStore);

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

const getSegments = (path) => String(path || '').split('/').filter(Boolean);
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

const resolveOptionalUser = async ({ event, traceId, requireAuth = false, allowLocalDemo = false }) => {
  if (!requireAuth && !hasAuthorizationHeader(event?.headers)) {
    const canUseLocalDemo = allowLocalDemo
      && !persistentStore.isPersistentPlatformAvailable()
      && !persistentStore.isPersistentPlatformRequired();
    return { ok: true, userId: canUseLocalDemo ? 'demo-user' : '' };
  }
  return resolveAuthenticatedUser({ event, requestTraceId: traceId, forceAuth: true });
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

const ensureRequiredPersistenceAvailable = ({ headers, startedAtMs, traceId }) => (
  persistentStore.isPersistentPlatformRequired() && !persistentStore.isPersistentPlatformAvailable()
    ? mutationUnavailableError({ headers, startedAtMs, traceId })
    : null
);

const ensurePersistentMutationAvailable = ({ headers, startedAtMs, traceId }) => (
  (persistentStore.isPersistentPlatformAvailable() || persistentStore.isPersistentPlatformRequired())
    && !persistentStore.isPersistentMutationAvailable()
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
  const store = getPlatformStore();
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
  const config = persistentStore.getPlatformPersistenceConfig();
  const references = validateContentAssetReferences({
    payload: normalized.value,
    existingPayload: existing,
    userId,
    entityType,
    supabaseUrl: config.supabaseUrl,
    bucket: config.storageBucket,
    enforceCanonical: persistentStore.isPersistentPlatformAvailable(),
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
export const handleRoomChat = async ({ event, headers, startedAtMs, traceId, roomId, storeOverride = null }) => {
  const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
  if (!authResult.ok) {
    return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || '로그인이 필요합니다.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
  }
  const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
  if (unavailable) return unavailable;

  const store = storeOverride || getPlatformStore();
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
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return mutationUnavailableError({ headers, startedAtMs, traceId });

  const chatRuntimeLimits = getChatRuntimeLimits();
  const dailyLimit = getDailyChatLimit();
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
        thinking_level: getGeminiThinkingLevel(),
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

    const result = await executeGeminiChatRequest({
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
    });
    if (!result.ok) {
      await refundBestEffort();
      return jsonError({ statusCode: result.error?.status === 429 ? 429 : 503, headers, startedAtMs, traceId, error: '응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.', errorCode: result.error?.status === 429 ? 'RESPONSE_RATE_LIMITED' : 'RESPONSE_SERVICE_UNAVAILABLE', retryable: true });
    }

    const normalizedMessage = normalizeAssistantPayload(result.modelText, {
      traceId,
      roomId,
      modelName: GEMINI_CHAT_MODEL_NAME,
      promptSnapshotLength: String(promptContext.promptSnapshot || '').length,
      historyMessageCount: roomHistory.length,
      outputLimit: chatRuntimeLimits.primaryMaxOutputTokens,
    });
    const guardedMessage = guardConfidentialPromptResponse({
      message: normalizedMessage,
      promptSnapshot: promptContext.promptSnapshot,
    });
    if (guardedMessage.blocked) {
      logServerWarn('[V-MATE] Confidential prompt disclosure blocked from model response', { traceId });
    }
    const message = guardedMessage.message;
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
        thinking_level: getGeminiThinkingLevel(),
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

export const handlePlatformApi = async ({ event, headers, startedAtMs, traceId }) => {
  const path = String(event.path || '/');
  const segments = getSegments(path);
  const method = String(event.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return jsonOk({ statusCode: 200, headers, startedAtMs, body: '' });
  }

  if (segments[0] !== 'api') {
    return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Not found.', errorCode: 'NOT_FOUND' });
  }

  // Production-like runtimes must never downgrade reads or writes to demo fixtures.
  const persistenceUnavailable = ensureRequiredPersistenceAvailable({ headers, startedAtMs, traceId });
  if (persistenceUnavailable) return persistenceUnavailable;

  if (!['GET', 'OPTIONS', 'HEAD'].includes(method)) {
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
  }

  // 공개 탐색 라우트
  if (method === 'GET' && segments[1] === 'home') {
    const query = parseQuery(event.queryStringParameters);
    const payload = await getPlatformStore().getHomePayload({
      tab: query.tab,
      search: query.search,
      filter: query.filter,
      characterFilter: query.characterFilter,
      worldFilter: query.worldFilter,
    });
    return jsonOk({ headers, startedAtMs, body: toPublicHomePayload(payload) });
  }

  if (method === 'GET' && segments[1] === 'characters' && !segments[2]) {
    const query = parseQuery(event.queryStringParameters);
    const items = await getPlatformStore().listCharacters({ search: query.search, filter: query.filter });
    return jsonOk({ headers, startedAtMs, body: { items: items.map(toPublicContentSummary) } });
  }

  if (method === 'GET' && segments[1] === 'worlds' && !segments[2]) {
    const query = parseQuery(event.queryStringParameters);
    const items = await getPlatformStore().listWorlds({ search: query.search, filter: query.filter });
    return jsonOk({ headers, startedAtMs, body: { items: items.map(toPublicContentSummary) } });
  }

  if (method === 'GET' && segments[1] === 'characters' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || '로그인 정보를 확인해주세요.', errorCode: authResult.errorCode || 'AUTH_UNAUTHORIZED', retryable: Boolean(authResult.retryable) });
    const store = getPlatformStore();
    const item = await store.getCharacterDetail({ event, slug: segments[2], userId: authResult.userId });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    const isOwner = Boolean(authResult.userId) && String(item.creator?.id || '') === authResult.userId;
    const bookmarked = await resolveViewerBookmarked({ store, event, userId: authResult.userId, entityType: 'character', targetId: item.id });
    return jsonOk({ headers, startedAtMs, body: { item: isOwner ? item : toPublicContentDetail(item), viewer: { bookmarked } } });
  }

  if (method === 'GET' && segments[1] === 'worlds' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || '로그인 정보를 확인해주세요.', errorCode: authResult.errorCode || 'AUTH_UNAUTHORIZED', retryable: Boolean(authResult.retryable) });
    const store = getPlatformStore();
    const item = await store.getWorldDetail({ event, slug: segments[2], userId: authResult.userId });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    const isOwner = Boolean(authResult.userId) && String(item.creator?.id || '') === authResult.userId;
    const bookmarked = await resolveViewerBookmarked({ store, event, userId: authResult.userId, entityType: 'world', targetId: item.id });
    return jsonOk({ headers, startedAtMs, body: { item: isOwner ? item : toPublicContentDetail(item), viewer: { bookmarked } } });
  }

  if (method === 'GET' && segments[1] === 'recent-rooms') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const query = parseQuery(event.queryStringParameters);
    return jsonOk({ headers, startedAtMs, body: { items: await getPlatformStore().listRecentRooms({ event, userId: authResult.userId, limit: query.limit, includeMessages: query.includeMessages }) } });
  }

  if (method === 'GET' && segments[1] === 'library') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const query = parseQuery(event.queryStringParameters);
    return jsonOk({ headers, startedAtMs, body: await getPlatformStore().getLibraryPayload({ event, userId: authResult.userId, includeRecentRooms: query.includeRecentRooms }) });
  }

  if (method === 'GET' && segments[1] === 'me' && segments[2] === 'chat-quota') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED' });
    return jsonOk({ headers, startedAtMs, body: { quota: await getPlatformStore().getChatQuota({ event, userId: authResult.userId, limit: getDailyChatLimit() }) } });
  }

  if (method === 'POST' && segments[1] === 'reports') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED' });
    const body = parseJsonBody(event.body);
    if (!body || !['character', 'world'].includes(body.entityType) || !String(body.entityId || '').trim() || !REPORT_REASONS.has(body.reason)) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid report payload.', errorCode: 'INVALID_REPORT' });
    try {
      const report = await getPlatformStore().createContentReport({ event, userId: authResult.userId, payload: body });
      if (!report) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Content not found.', errorCode: 'CONTENT_NOT_FOUND' });
      return jsonOk({ statusCode: 201, headers, startedAtMs, body: { report } });
    } catch (error) {
      if (error?.code === 'REPORT_ALREADY_OPEN' || error?.code === '23505') return jsonError({ statusCode: 409, headers, startedAtMs, traceId, error: '이미 검토 중인 신고가 있습니다.', errorCode: 'REPORT_ALREADY_OPEN' });
      throw error;
    }
  }

  // 로그인 사용자 데이터 라우트
  if (method === 'DELETE' && segments[1] === 'account' && !segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    let result;
    try {
      result = await getPlatformStore().deleteAccount({ event, userId: authResult.userId });
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

  if (method === 'POST' && segments[1] === 'recent-views') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    await getPlatformStore().addRecentView({ event, userId: authResult.userId, entityType: String(body.entityType || '').trim(), ref: body.entityRef || body.slug || body.id });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { ok: true } });
  }

  if (method === 'POST' && segments[1] === 'bookmarks') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const result = await getPlatformStore().toggleBookmark({ event, userId: authResult.userId, entityType: String(body.entityType || '').trim(), ref: body.entityRef || body.slug || body.id });
    if (!result) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Entity not found.', errorCode: 'ENTITY_NOT_FOUND' });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: result });
  }

  if (method === 'DELETE' && segments[1] === 'bookmarks' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    await getPlatformStore().removeBookmark({ event, userId: authResult.userId, bookmarkId: segments[2] });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  // 제작 및 편집 라우트
  if (method === 'POST' && segments[1] === 'characters') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const validation = await validateContentRequest({ event, userId: authResult.userId, entityType: 'character', body, mode: 'create' });
    if (!validation.ok) return toContentValidationError({ validation, headers, startedAtMs, traceId });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { item: await getPlatformStore().createCharacter({ event, userId: authResult.userId, payload: validation.value }) } });
  }

  if (method === 'PATCH' && segments[1] === 'characters' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const validation = await validateContentRequest({ event, userId: authResult.userId, entityType: 'character', body, mode: 'patch', slug: segments[2] });
    if (validation.notFound) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    if (!validation.ok) return toContentValidationError({ validation, headers, startedAtMs, traceId });
    const item = await getPlatformStore().updateCharacter?.({ event, userId: authResult.userId, slug: segments[2], payload: validation.value });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { item } });
  }

  if (method === 'DELETE' && segments[1] === 'characters' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    let ok;
    try {
      ok = await (getPlatformStore().deleteOwnedContent?.({ event, userId: authResult.userId, entityType: 'character', id: segments[2] })
        ?? getPlatformStore().deleteContent({ event, entityType: 'character', id: segments[2] }));
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (method === 'POST' && segments[1] === 'worlds') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const validation = await validateContentRequest({ event, userId: authResult.userId, entityType: 'world', body, mode: 'create' });
    if (!validation.ok) return toContentValidationError({ validation, headers, startedAtMs, traceId });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { item: await getPlatformStore().createWorld({ event, userId: authResult.userId, payload: validation.value }) } });
  }

  if (method === 'PATCH' && segments[1] === 'worlds' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const validation = await validateContentRequest({ event, userId: authResult.userId, entityType: 'world', body, mode: 'patch', slug: segments[2] });
    if (validation.notFound) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    if (!validation.ok) return toContentValidationError({ validation, headers, startedAtMs, traceId });
    const item = await getPlatformStore().updateWorld?.({ event, userId: authResult.userId, slug: segments[2], payload: validation.value });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { item } });
  }

  if (method === 'DELETE' && segments[1] === 'worlds' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    let ok;
    try {
      ok = await (getPlatformStore().deleteOwnedContent?.({ event, userId: authResult.userId, entityType: 'world', id: segments[2] })
        ?? getPlatformStore().deleteContent({ event, entityType: 'world', id: segments[2] }));
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (method === 'POST' && segments[1] === 'uploads' && segments[2] === 'prepare') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: '요청 본문을 확인해주세요.', errorCode: 'INVALID_REQUEST_BODY' });
    const entityType = String(body.entityType || '');
    const variantsValidation = validateUploadVariants({ entityType, variants: body.variants });
    if (!variantsValidation.ok) return toContentValidationError({ validation: variantsValidation, headers, startedAtMs, traceId });
    let prepared;
    try {
      prepared = await getPlatformStore().prepareAssetUploads({ event, userId: authResult.userId, entityType, variants: variantsValidation.value });
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    return jsonOk({ headers, startedAtMs, body: prepared });
  }

  if (method === 'POST' && segments[1] === 'rooms' && segments.length === 2) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
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
      room = await getPlatformStore().createRoom({ event, userId: authResult.userId, characterSlug, worldSlug, userAlias });
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    if (!room) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'ROOM_TARGET_NOT_FOUND' });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { room } });
  }

  if (method === 'GET' && segments[1] === 'rooms' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable(), allowLocalDemo: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const room = await getPlatformStore().getRoom({ event, roomId: segments[2], userId: authResult.userId });
    if (!room) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Room not found.', errorCode: 'ROOM_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { room } });
  }

  if (method === 'POST' && segments[1] === 'rooms' && segments[2] && segments[3] === 'chat') {
    return handleRoomChat({ event, headers, startedAtMs, traceId, roomId: segments[2] });
  }

  // owner 전용 운영 라우트
  if (method === 'GET' && segments[1] === 'ops' && segments[2] === 'reports') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED' });
    const isOwner = await getPlatformStore().isOwnerUser?.({ event, userId: authResult.userId });
    if (!isOwner) return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
    const status = String(event.queryStringParameters?.status || 'open');
    return jsonOk({ headers, startedAtMs, body: { reports: await getPlatformStore().listContentReports({ event, status }) } });
  }

  if (method === 'PATCH' && segments[1] === 'ops' && segments[2] === 'reports' && segments[3]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED' });
    const isOwner = await getPlatformStore().isOwnerUser?.({ event, userId: authResult.userId });
    if (!isOwner) return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
    const body = parseJsonBody(event.body);
    if (!body || !['dismiss', 'restore', 'quarantine', 'remove'].includes(body.action)) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid moderation action.', errorCode: 'INVALID_MODERATION_ACTION' });
    const result = await getPlatformStore().applyReportAction({ event, userId: authResult.userId, reportId: segments[3], action: body.action, note: String(body.note || '') });
    if (!result) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Report not found.', errorCode: 'REPORT_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: result });
  }

  if (method === 'GET' && segments[1] === 'ops' && segments[2] === 'dashboard') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const isOwner = await getPlatformStore().isOwnerUser?.({ event, userId: authResult.userId });
    if (!isOwner) {
      return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
    }
    try {
      const dashboard = await getPlatformStore().getOpsDashboard({ event, userId: authResult.userId });
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

  if (method === 'POST' && segments[1] === 'ops' && segments[2] === 'content' && segments[3] && segments[4] && segments[5]) {
    const status = segments[5] === 'hide' ? 'hidden' : segments[5] === 'show' ? 'visible' : null;
    if (!status) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Not found.', errorCode: 'NOT_FOUND' });
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const isOwner = await getPlatformStore().isOwnerUser?.({ event, userId: authResult.userId });
    if (!isOwner) {
      return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
    }
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    const ok = await getPlatformStore().setContentVisibility({ event, userId: authResult.userId, entityType: segments[3], id: segments[4], status });
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Content not found.', errorCode: 'CONTENT_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (method === 'DELETE' && segments[1] === 'ops' && segments[2] === 'content' && segments[3] && segments[4]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const isOwner = await getPlatformStore().isOwnerUser?.({ event, userId: authResult.userId });
    if (!isOwner) {
      return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
    }
    const unavailable = ensurePersistentMutationAvailable({ headers, startedAtMs, traceId });
    if (unavailable) return unavailable;
    let ok;
    try {
      ok = await getPlatformStore().deleteContent({ event, userId: authResult.userId, entityType: segments[3], id: segments[4] });
    } catch (error) {
      const mapped = mapStoreError({ error, headers, startedAtMs, traceId });
      if (mapped) return mapped;
      throw error;
    }
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Content not found.', errorCode: 'CONTENT_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (method === 'POST' && segments[1] === 'ops' && segments[2] === 'home' && segments[3] === 'banner') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const isOwner = await getPlatformStore().isOwnerUser?.({ event, userId: authResult.userId });
    if (!isOwner) {
      return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
    }
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    return jsonOk({ headers, startedAtMs, body: { home: await getPlatformStore().setHomeHeroTarget({ event, targetPath: String(body.targetPath || '') }) } });
  }

  if (method === 'POST' && segments[1] === 'ops' && segments[2] === 'home' && segments[3] === 'banner-mode') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const isOwner = await getPlatformStore().isOwnerUser?.({ event, userId: authResult.userId });
    if (!isOwner) {
      return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
    }
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    return jsonOk({ headers, startedAtMs, body: { home: await getPlatformStore().setHomeHeroMode({ event, mode: String(body.mode || 'auto') }) } });
  }

  if (method === 'POST' && segments[1] === 'ops' && segments[2] === 'home' && segments[3] === 'banner-target') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const isOwner = await getPlatformStore().isOwnerUser?.({ event, userId: authResult.userId });
    if (!isOwner) {
      return jsonError({ statusCode: 403, headers, startedAtMs, traceId, error: 'Owner access required.', errorCode: 'OWNER_FORBIDDEN' });
    }
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    return jsonOk({ headers, startedAtMs, body: { home: await getPlatformStore().setHomeHeroTarget({ event, targetPath: String(body.targetPath || '') }) } });
  }

  return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Not found.', errorCode: 'NOT_FOUND' });
};
