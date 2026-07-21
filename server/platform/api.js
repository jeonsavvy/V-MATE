import { buildApiErrorResult, buildJsonResult } from '../modules/http-response.js';
import { getChatAuthConfig, getChatRuntimeLimits, getDailyChatLimit, getGeminiThinkingLevel } from '../modules/runtime-config.js';
import { resolveAuthenticatedUser } from '../modules/auth-guard.js';
import { executeGeminiChatRequest } from '../modules/gemini-orchestrator.js';
import { normalizeAssistantPayload } from '../modules/response-normalizer.js';
import { logServerWarn } from '../modules/server-logger.js';
import * as memoryStore from './content-store.js';
import * as persistentStore from './supabase-platform-repository.js';

// 플랫폼 라우터는 public read, authenticated write, owner ops를 하나의 계약으로 묶는다.
const PLATFORM_ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

// Supabase가 준비되면 persistent store를, 아니면 memory store를 선택해 같은 API를 유지한다.
const getPlatformStore = () => (persistentStore.isPersistentPlatformAvailable() ? persistentStore : memoryStore);

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
const parseQuery = (queryStringParameters = {}) => ({
  search: String(queryStringParameters.search || '').trim(),
  filter: String(queryStringParameters.filter || '').trim(),
  tab: String(queryStringParameters.tab || 'characters').trim(),
  tag: String(queryStringParameters.tag || '').trim(),
});

const resolveOptionalUser = async ({ event, traceId, requireAuth = false }) => {
  const { requireAuth: defaultRequireAuth } = getChatAuthConfig();
  if (!requireAuth && !defaultRequireAuth) {
    return { ok: true, userId: 'demo-user' };
  }
  const authResult = await resolveAuthenticatedUser({ event, requestTraceId: traceId, forceAuth: requireAuth });
  return authResult.ok ? authResult : authResult;
};

const normalizeCharacterPayload = (payload) => ({
  name: String(payload.name || '').trim(),
  headline: String(payload.headline || '').trim(),
  summary: String(payload.summary || '').trim(),
  tags: Array.isArray(payload.tags) ? payload.tags.map((item) => String(item).trim()).filter(Boolean) : [],
  visibility: String(payload.visibility || 'private').trim(),
  sourceType: String(payload.sourceType || 'original').trim(),
  coverImageUrl: String(payload.coverImageUrl || '').trim(),
  avatarImageUrl: String(payload.avatarImageUrl || '').trim(),
  creatorName: String(payload.creatorName || '').trim(),
  sourceUrl: String(payload.sourceUrl || '').trim(),
  rightsConfirmed: payload.rightsConfirmed === true,
});

const normalizeWorldPayload = (payload) => ({
  name: String(payload.name || '').trim(),
  headline: String(payload.headline || '').trim(),
  summary: String(payload.summary || '').trim(),
  tags: Array.isArray(payload.tags) ? payload.tags.map((item) => String(item).trim()).filter(Boolean) : [],
  visibility: String(payload.visibility || 'private').trim(),
  sourceType: String(payload.sourceType || 'original').trim(),
  coverImageUrl: String(payload.coverImageUrl || '').trim(),
  worldRulesMarkdown: String(payload.worldRulesMarkdown || '').trim(),
  creatorName: String(payload.creatorName || '').trim(),
  sourceUrl: String(payload.sourceUrl || '').trim(),
  rightsConfirmed: payload.rightsConfirmed === true,
});

const getPublishAttestationError = (payload) => {
  if (String(payload?.visibility || 'private') !== 'public') return null;
  if (payload?.rightsConfirmed !== true) return { error: '공개하려면 콘텐츠 권리 보유를 확인해야 합니다.', errorCode: 'RIGHTS_ATTESTATION_REQUIRED' };
  return null;
};
const REPORT_REASONS = new Set(['sexual_content', 'minor_safety', 'hate_or_harassment', 'copyright', 'spam', 'other']);

// 룸 채팅은 room 존재 확인, auth, 모델 호출, 메시지 정규화를 한 트랜잭션 흐름처럼 다룬다.
const handleRoomChat = async ({ event, headers, startedAtMs, traceId, roomId }) => {
  const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
  if (!authResult.ok) {
    return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
  }

  const room = await getPlatformStore().getRoom({ event, roomId });
  if (!room) {
    return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Room not found.', errorCode: 'ROOM_NOT_FOUND' });
  }

  const body = parseJsonBody(event.body);
  if (!body) {
    return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
  }

  const userMessage = String(body.userMessage || '').trim();
  if (!userMessage) {
    return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'userMessage is required.', errorCode: 'INVALID_USER_MESSAGE' });
  }

  const clientRequestId = String(body.clientRequestId || '').trim();
  if (clientRequestId && !/^[A-Za-z0-9_-]{8,128}$/.test(clientRequestId)) {
    return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'clientRequestId must use 8-128 URL-safe characters.', errorCode: 'INVALID_CLIENT_REQUEST_ID' });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return jsonError({ statusCode: 500, headers, startedAtMs, traceId, error: 'API key not configured. Please set GOOGLE_API_KEY in runtime secrets.', errorCode: 'SERVER_API_KEY_NOT_CONFIGURED' });
  }

  const promptContext = await getPlatformStore().getRoomPromptContext({ event, roomId });
  if (!promptContext) {
    return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Room not found.', errorCode: 'ROOM_NOT_FOUND' });
  }

  const roomHistory = await getPlatformStore().getRoomHistoryForModel({ event, roomId });
  const chatRuntimeLimits = getChatRuntimeLimits();
  const dailyLimit = getDailyChatLimit();
  const quotaRequestId = `${authResult.userId}:${roomId}:${clientRequestId || traceId}`;
  const quota = await getPlatformStore().reserveChatQuota({ event, userId: authResult.userId, requestId: quotaRequestId, limit: dailyLimit });
  if (quota?.duplicate) {
    if (quota.response?.message) {
      const currentRoom = await getPlatformStore().getRoom({ event, roomId });
      return jsonOk({
        headers,
        startedAtMs,
        body: {
          room: currentRoom || room,
          message: quota.response.message,
          trace_id: quota.response.trace_id || traceId,
          quota: { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt },
          thinking_level: getGeminiThinkingLevel(),
          history_window: chatRuntimeLimits.maxHistoryMessages,
        },
      });
    }
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
  if (!quota?.allowed) {
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
  const roomModelName = 'gemini-3-flash-preview';

  let result;
  try {
    result = await executeGeminiChatRequest({
      apiKey,
      modelName: roomModelName,
      requestStartedAt: startedAtMs,
      requestTraceId: traceId,
      normalizedCharacterId: room.character.slug,
      userMessage,
      messageHistory: roomHistory,
      requestCachedContent: null,
      trimmedSystemPrompt: promptContext.promptSnapshot,
      promptCacheAdapter: null,
    });
  } catch (error) {
    await getPlatformStore().refundChatQuota({ event, userId: authResult.userId, requestId: quotaRequestId, limit: dailyLimit });
    throw error;
  }

  if (!result.ok) {
    await getPlatformStore().refundChatQuota({ event, userId: authResult.userId, requestId: quotaRequestId, limit: dailyLimit });
    return jsonError({ statusCode: result.error?.status || 500, headers, startedAtMs, traceId, error: result.error?.message || 'Room chat failed.', errorCode: result.error?.code || 'ROOM_CHAT_FAILED', retryable: Boolean(result.retryable) });
  }

  const message = normalizeAssistantPayload(result.modelText, {
    traceId,
    roomId,
    modelName: roomModelName,
    promptSnapshotLength: String(promptContext.promptSnapshot || '').length,
    historyMessageCount: roomHistory.length,
    outputLimit: chatRuntimeLimits.primaryMaxOutputTokens,
  });
  const nextRoom = await getPlatformStore().appendRoomMessages({ event, roomId, userMessage, assistantMessage: message });

  try {
    await getPlatformStore().completeChatQuota?.({ event, userId: authResult.userId, requestId: quotaRequestId, response: { message, trace_id: traceId } });
  } catch (error) {
    logServerWarn('[V-MATE] Chat response completed but idempotency snapshot could not be stored', {
      roomId,
      traceId,
      message: error?.message || String(error),
    });
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

  // 공개 탐색 라우트
  if (method === 'GET' && segments[1] === 'home') {
    const query = parseQuery(event.queryStringParameters);
    return jsonOk({ headers, startedAtMs, body: await getPlatformStore().getHomePayload({ tab: query.tab, search: query.search, filter: query.filter }) });
  }

  if (method === 'GET' && segments[1] === 'characters' && !segments[2]) {
    const query = parseQuery(event.queryStringParameters);
    return jsonOk({ headers, startedAtMs, body: { items: await getPlatformStore().listCharacters({ search: query.search, filter: query.filter }) } });
  }

  if (method === 'GET' && segments[1] === 'worlds' && !segments[2]) {
    const query = parseQuery(event.queryStringParameters);
    return jsonOk({ headers, startedAtMs, body: { items: await getPlatformStore().listWorlds({ search: query.search, filter: query.filter }) } });
  }

  if (method === 'GET' && segments[1] === 'characters' && segments[2]) {
    const item = await getPlatformStore().getCharacterDetail(segments[2]);
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { item } });
  }

  if (method === 'GET' && segments[1] === 'worlds' && segments[2]) {
    const item = await getPlatformStore().getWorldDetail(segments[2]);
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { item } });
  }

  if (method === 'GET' && segments[1] === 'recent-rooms') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    return jsonOk({ headers, startedAtMs, body: { items: await getPlatformStore().listRecentRooms({ event, userId: authResult.userId }) } });
  }

  if (method === 'GET' && segments[1] === 'library') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    return jsonOk({ headers, startedAtMs, body: await getPlatformStore().getLibraryPayload({ event, userId: authResult.userId }) });
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
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const result = await getPlatformStore().deleteAccount({ event, userId: authResult.userId });
    if (result?.reason === 'admin_not_configured') {
      return jsonError({
        statusCode: 503,
        headers,
        startedAtMs,
        traceId,
        error: 'Account deletion is not configured. SUPABASE_SERVICE_ROLE_KEY is required on the Worker.',
        errorCode: 'ACCOUNT_DELETE_NOT_CONFIGURED',
      });
    }
    return jsonOk({ headers, startedAtMs, body: { ok: true, deleted: true, data: result } });
  }

  if (method === 'POST' && segments[1] === 'recent-views') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    await getPlatformStore().addRecentView({ event, userId: authResult.userId, entityType: String(body.entityType || '').trim(), ref: body.entityRef || body.slug || body.id });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { ok: true } });
  }

  if (method === 'POST' && segments[1] === 'bookmarks') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const result = await getPlatformStore().toggleBookmark({ event, userId: authResult.userId, entityType: String(body.entityType || '').trim(), ref: body.entityRef || body.slug || body.id });
    if (!result) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Entity not found.', errorCode: 'ENTITY_NOT_FOUND' });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: result });
  }

  if (method === 'DELETE' && segments[1] === 'bookmarks' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    await getPlatformStore().removeBookmark({ event, userId: authResult.userId, bookmarkId: segments[2] });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  // 제작 및 편집 라우트
  if (method === 'POST' && segments[1] === 'characters') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const attestationError = getPublishAttestationError(body);
    if (attestationError) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, ...attestationError });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { item: await getPlatformStore().createCharacter({ event, userId: authResult.userId, payload: { ...normalizeCharacterPayload(body), assets: body.assets, profileJson: body.profileJson, speechStyleJson: body.speechStyleJson, promptProfileJson: body.promptProfileJson } }) } });
  }

  if (method === 'PATCH' && segments[1] === 'characters' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const attestationError = getPublishAttestationError(body);
    if (attestationError) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, ...attestationError });
    const item = await getPlatformStore().updateCharacter?.({ event, userId: authResult.userId, slug: segments[2], payload: { ...normalizeCharacterPayload(body), assets: body.assets, profileJson: body.profileJson, speechStyleJson: body.speechStyleJson, promptProfileJson: body.promptProfileJson } });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { item } });
  }

  if (method === 'DELETE' && segments[1] === 'characters' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const ok = await (getPlatformStore().deleteOwnedContent?.({ event, userId: authResult.userId, entityType: 'character', id: segments[2] })
      ?? getPlatformStore().deleteContent({ event, entityType: 'character', id: segments[2] }));
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'CHARACTER_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (method === 'POST' && segments[1] === 'worlds') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const attestationError = getPublishAttestationError(body);
    if (attestationError) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, ...attestationError });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { item: await getPlatformStore().createWorld({ event, userId: authResult.userId, payload: { ...normalizeWorldPayload(body), assets: body.assets, promptProfileJson: body.promptProfileJson } }) } });
  }

  if (method === 'PATCH' && segments[1] === 'worlds' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const attestationError = getPublishAttestationError(body);
    if (attestationError) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, ...attestationError });
    const item = await getPlatformStore().updateWorld?.({ event, userId: authResult.userId, slug: segments[2], payload: { ...normalizeWorldPayload(body), assets: body.assets, promptProfileJson: body.promptProfileJson } });
    if (!item) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { item } });
  }

  if (method === 'DELETE' && segments[1] === 'worlds' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: true });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const ok = await (getPlatformStore().deleteOwnedContent?.({ event, userId: authResult.userId, entityType: 'world', id: segments[2] })
      ?? getPlatformStore().deleteContent({ event, entityType: 'world', id: segments[2] }));
    if (!ok) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'World not found.', errorCode: 'WORLD_NOT_FOUND' });
    return jsonOk({ headers, startedAtMs, body: { ok: true } });
  }

  if (method === 'POST' && segments[1] === 'uploads' && segments[2] === 'prepare') {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const variants = Array.isArray(body.variants) ? body.variants.map((item) => ({ kind: String(item.kind || ''), width: Number(item.width || 0), height: Number(item.height || 0) })).filter((item) => item.kind && item.width > 0 && item.height > 0) : [];
    if (!variants.length) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'variants is required.', errorCode: 'INVALID_REQUEST_BODY' });
    const prepared = await getPlatformStore().prepareAssetUploads({ event, userId: authResult.userId, entityType: String(body.entityType || 'character'), variants });
    return jsonOk({ headers, startedAtMs, body: prepared });
  }

  if (method === 'POST' && segments[1] === 'rooms' && segments.length === 2) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const body = parseJsonBody(event.body);
    if (!body) return jsonError({ statusCode: 400, headers, startedAtMs, traceId, error: 'Invalid request body.', errorCode: 'INVALID_REQUEST_BODY' });
    const room = await getPlatformStore().createRoom({
      event,
      userId: authResult.userId,
      characterSlug: body.characterSlug || body.characterId,
      worldSlug: body.worldSlug || body.worldId || null,
      userAlias: String(body.userAlias || '').trim() || '나',
    });
    if (!room) return jsonError({ statusCode: 404, headers, startedAtMs, traceId, error: 'Character not found.', errorCode: 'ROOM_TARGET_NOT_FOUND' });
    return jsonOk({ statusCode: 201, headers, startedAtMs, body: { room } });
  }

  if (method === 'GET' && segments[1] === 'rooms' && segments[2]) {
    const authResult = await resolveOptionalUser({ event, traceId, requireAuth: persistentStore.isPersistentPlatformAvailable() });
    if (!authResult.ok) return jsonError({ statusCode: authResult.statusCode || 401, headers, startedAtMs, traceId, error: authResult.error || 'Authentication required.', errorCode: authResult.errorCode || 'AUTH_REQUIRED', retryable: Boolean(authResult.retryable) });
    const room = await getPlatformStore().getRoom({ event, roomId: segments[2] });
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
    return jsonOk({ headers, startedAtMs, body: await getPlatformStore().getOpsDashboard({ event, userId: authResult.userId }) });
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
    const ok = await getPlatformStore().setContentVisibility({ event, entityType: segments[3], id: segments[4], status });
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
    const ok = await getPlatformStore().deleteContent({ event, entityType: segments[3], id: segments[4] });
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
