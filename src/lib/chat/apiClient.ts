import type { AIResponse, CharacterId } from "@/lib/data"
import { CHAT_REQUEST_LIMITS } from "@/lib/chat/chatContract"

export type ChatRequestHistoryItem = {
  role: "user" | "assistant"
  content: string
}

export type ChatRequestV2 = {
  characterId: CharacterId
  userMessage: string
  messageHistory: ChatRequestHistoryItem[]
  cachedContent?: string
  clientRequestId?: string
}

export type ChatResponseV2 = {
  message: AIResponse
  cachedContent: string | null
  trace_id: string
}

export type ChatApiError = Error & {
  chatErrorCode?: string
  chatTraceId?: string
}

const ALLOWED_EMOTIONS = new Set<AIResponse["emotion"]>(["normal", "happy", "confused", "angry"])
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/
const CACHED_CONTENT_PATTERN = /^cachedContents\/[A-Za-z0-9/_\-.]+$/

export const NETWORK_ERROR_CODES = new Set([
  "CLIENT_NETWORK_ERROR",
  "CLIENT_TIMEOUT",
  "UPSTREAM_CONNECTION_FAILED",
  "UPSTREAM_TIMEOUT",
  "FUNCTION_BUDGET_TIMEOUT",
  "UPSTREAM_EMPTY_RESPONSE",
  "UPSTREAM_EMPTY_RESPONSE_MAX_TOKENS",
])

export const CONFIGURATION_ERROR_CODES = new Set([
  "SERVER_API_KEY_NOT_CONFIGURED",
  "UPSTREAM_LOCATION_UNSUPPORTED",
  "UPSTREAM_INVALID_FORMAT",
  "UPSTREAM_INVALID_RESPONSE",
  "UPSTREAM_MODEL_ERROR",
])

export const REQUEST_POLICY_ERROR_CODES = new Set([
  "METHOD_NOT_ALLOWED",
  "ORIGIN_NOT_ALLOWED",
  "AUTH_REQUIRED",
  "AUTH_UNAUTHORIZED",
  "AUTH_PROVIDER_NOT_CONFIGURED",
  "AUTH_PROVIDER_TIMEOUT",
  "AUTH_PROVIDER_UNAVAILABLE",
  "AUTH_PROVIDER_ERROR",
  "AUTH_PROVIDER_INVALID_RESPONSE",
  "REQUEST_BODY_TOO_LARGE",
  "UNSUPPORTED_CONTENT_TYPE",
  "INVALID_REQUEST_BODY",
  "INVALID_CHARACTER_ID",
  "INVALID_USER_MESSAGE",
  "INVALID_MESSAGE_HISTORY",
  "INVALID_CACHED_CONTENT",
  "INVALID_CLIENT_REQUEST_ID",
])

const resolveRuntimeEnv = () =>
  ((globalThis as { __V_MATE_RUNTIME_ENV__?: Record<string, string | undefined> }).__V_MATE_RUNTIME_ENV__ ?? {})

const resolveChatApiUrl = (): string => {
  const runtimeEnv = resolveRuntimeEnv()
  const baseUrl = String(runtimeEnv.VITE_CHAT_API_BASE_URL || import.meta.env.VITE_CHAT_API_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "")

  if (!baseUrl) {
    return "/api/chat"
  }

  return baseUrl.endsWith("/api/chat") ? baseUrl : `${baseUrl}/api/chat`
}

const sanitizeAssistantMessage = (value: unknown): AIResponse | null => {
  if (!value || typeof value !== "object") {
    return null
  }

  const payload = value as Record<string, unknown>
  const rawEmotion = typeof payload.emotion === "string" ? payload.emotion.toLowerCase().trim() : "normal"
  const emotion = ALLOWED_EMOTIONS.has(rawEmotion as AIResponse["emotion"])
    ? (rawEmotion as AIResponse["emotion"])
    : "normal"
  const response = typeof payload.response === "string" ? payload.response.trim() : ""
  if (!response) {
    return null
  }

  const innerHeart = typeof payload.inner_heart === "string" ? payload.inner_heart.trim() : ""
  const narration = typeof payload.narration === "string" ? payload.narration.trim() : ""

  return {
    emotion,
    inner_heart: innerHeart,
    response,
    ...(narration ? { narration } : {}),
  }
}

const parseMessageFromResponse = (data: unknown): AIResponse | null => {
  if (!data || typeof data !== "object") {
    return null
  }

  const payload = data as Record<string, unknown>
  const directMessage = sanitizeAssistantMessage(payload.message)
  if (directMessage) {
    return directMessage
  }

  if (typeof payload.text === "string") {
    try {
      const parsed = JSON.parse(payload.text)
      return sanitizeAssistantMessage(parsed)
    } catch {
      return null
    }
  }

  return null
}

export const createChatApiError = (message: string, errorCode?: string, traceId?: string): ChatApiError => {
  const error = new Error(message) as ChatApiError
  if (errorCode) {
    error.chatErrorCode = errorCode
  }
  if (traceId) {
    error.chatTraceId = traceId
  }
  return error
}

const normalizeChatRequestPayload = (payload: ChatRequestV2): ChatRequestV2 => {
  const normalizedUserMessage = String(payload.userMessage || "")
    .trim()
    .slice(0, CHAT_REQUEST_LIMITS.userMessageMaxChars)

  if (!normalizedUserMessage) {
    throw createChatApiError("메시지를 입력해주세요.", "INVALID_USER_MESSAGE")
  }

  const normalizedHistory = (Array.isArray(payload.messageHistory) ? payload.messageHistory : [])
    .map((item) => {
      const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : null
      if (!role) {
        return null
      }

      const content = String(item.content || "")
        .trim()
        .slice(0, CHAT_REQUEST_LIMITS.historyContentMaxChars)
      if (!content) {
        return null
      }

      return { role, content }
    })
    .filter((item): item is ChatRequestHistoryItem => item !== null)
    .slice(-CHAT_REQUEST_LIMITS.historyMaxItems)

  const nextPayload: ChatRequestV2 = {
    characterId: payload.characterId,
    userMessage: normalizedUserMessage,
    messageHistory: normalizedHistory,
  }

  if (typeof payload.cachedContent === "string") {
    const normalizedCachedContent = payload.cachedContent
      .trim()
      .slice(0, CHAT_REQUEST_LIMITS.cachedContentMaxChars)
    if (normalizedCachedContent && CACHED_CONTENT_PATTERN.test(normalizedCachedContent)) {
      nextPayload.cachedContent = normalizedCachedContent
    }
  }

  if (typeof payload.clientRequestId === "string") {
    const normalizedClientRequestId = payload.clientRequestId.trim()
    if (
      normalizedClientRequestId &&
      normalizedClientRequestId.length <= CHAT_REQUEST_LIMITS.clientRequestIdMaxChars &&
      CLIENT_REQUEST_ID_PATTERN.test(normalizedClientRequestId)
    ) {
      nextPayload.clientRequestId = normalizedClientRequestId
    }
  }

  return nextPayload
}

export const mapChatApiErrorMessage = (errorCode: string, fallbackMessage: string) => {
  switch (errorCode) {
    case "REQUEST_BODY_TOO_LARGE":
      return "요청 본문이 너무 큽니다. 메시지 길이를 줄여 다시 시도해주세요."
    case "INVALID_CHARACTER_ID":
      return "지원하지 않는 캐릭터 요청입니다. 다시 선택 후 시도해주세요."
    case "INVALID_USER_MESSAGE":
      return "메시지가 비어 있거나 너무 깁니다. 내용을 확인해주세요."
    case "INVALID_CLIENT_REQUEST_ID":
      return "요청 식별자 형식이 올바르지 않습니다. 새로고침 후 다시 시도해주세요."
    case "INVALID_REQUEST_BODY":
      return "요청 형식이 올바르지 않습니다. 앱을 새로고침 후 다시 시도해주세요."
    case "INVALID_MESSAGE_HISTORY":
      return "대화 히스토리 형식이 올바르지 않습니다. 잠시 후 다시 시도해주세요."
    case "INVALID_CACHED_CONTENT":
      return "세션 캐시가 만료되었습니다. 다시 시도해주세요."
    case "UNSUPPORTED_CONTENT_TYPE":
      return "요청 Content-Type이 올바르지 않습니다. 앱을 새로고침 후 다시 시도해주세요."
    case "METHOD_NOT_ALLOWED":
      return "지원하지 않는 요청 방식입니다. 앱을 새로고침 후 다시 시도해주세요."
    case "ORIGIN_NOT_ALLOWED":
      return "현재 접속한 도메인에서는 API 호출이 허용되지 않습니다."
    case "AUTH_REQUIRED":
      return "채팅은 로그인 후 이용할 수 있습니다."
    case "AUTH_UNAUTHORIZED":
      return "로그인 세션이 만료되었습니다. 다시 로그인해주세요."
    case "AUTH_PROVIDER_NOT_CONFIGURED":
      return "인증 서버 설정이 완료되지 않았습니다. 관리자에게 문의해주세요."
    case "AUTH_PROVIDER_TIMEOUT":
    case "AUTH_PROVIDER_UNAVAILABLE":
      return "인증 서버 연결이 불안정합니다. 잠시 후 다시 시도해주세요."
    case "AUTH_PROVIDER_ERROR":
    case "AUTH_PROVIDER_INVALID_RESPONSE":
      return "인증 검증 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
    case "SERVER_API_KEY_NOT_CONFIGURED":
      return "서버 설정 문제로 요청을 처리할 수 없습니다. 관리자에게 문의해주세요."
    case "INTERNAL_SERVER_ERROR":
      return "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
    case "RATE_LIMIT_EXCEEDED":
    case "HTTP_429":
      return "요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요."
    case "UPSTREAM_CONNECTION_FAILED":
    case "UPSTREAM_TIMEOUT":
    case "FUNCTION_BUDGET_TIMEOUT":
    case "UPSTREAM_EMPTY_RESPONSE":
    case "UPSTREAM_EMPTY_RESPONSE_MAX_TOKENS":
      return "AI 서버 연결이 불안정합니다. 잠시 후 다시 시도해주세요."
    case "UPSTREAM_LOCATION_UNSUPPORTED":
      return "현재 서버 지역에서는 Gemini API를 사용할 수 없습니다. 관리자에게 문의해주세요."
    case "UPSTREAM_INVALID_RESPONSE":
    case "UPSTREAM_INVALID_FORMAT":
      return "AI 응답 형식이 불안정합니다. 잠시 후 다시 시도해주세요."
    case "UPSTREAM_MODEL_ERROR":
      return "AI 서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
    default:
      return fallbackMessage
  }
}

interface SendChatMessageParams {
  payload: ChatRequestV2
  signal: AbortSignal
  apiVersion?: "1" | "2"
  accessToken?: string
}

export const sendChatMessage = async ({
  payload,
  signal,
  apiVersion = "2",
  accessToken = "",
}: SendChatMessageParams): Promise<ChatResponseV2> => {
  const chatApiUrl = resolveChatApiUrl()
  const normalizedPayload = normalizeChatRequestPayload(payload)
  let response: Response

  try {
    const normalizedAccessToken = String(accessToken || "").trim()
    response = await fetch(chatApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-V-MATE-API-Version": apiVersion,
        ...(normalizedAccessToken ? { Authorization: `Bearer ${normalizedAccessToken}` } : {}),
      },
      body: JSON.stringify({
        ...normalizedPayload,
        api_version: apiVersion,
      }),
      signal,
    })
  } catch (fetchError) {
    if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
      throw createChatApiError("응답 시간이 초과되었습니다. 네트워크 연결을 확인해주세요.", "CLIENT_TIMEOUT")
    }

    const message = fetchError instanceof Error ? fetchError.message : String(fetchError)
    if (message.includes("Failed to fetch")) {
      throw createChatApiError("서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.", "CLIENT_NETWORK_ERROR")
    }

    throw createChatApiError(message || "AI 서버 호출 중 오류가 발생했습니다.", "CLIENT_NETWORK_ERROR")
  }

  let data: Record<string, unknown> = {}
  try {
    const parsed = await response.json()
    if (parsed && typeof parsed === "object") {
      data = parsed as Record<string, unknown>
    }
  } catch {
    data = {}
  }

  const traceId = typeof data.trace_id === "string"
    ? data.trace_id.trim()
    : String(response.headers.get("x-v-mate-trace-id") || "").trim()
  const headerErrorCode = String(response.headers.get("x-v-mate-error-code") || "").trim()

  if (!response.ok) {
    const errorCode = typeof data.error_code === "string"
      ? data.error_code
      : headerErrorCode || `HTTP_${response.status}`
    const errorText = typeof data.error === "string" ? data.error : "서버 오류가 발생했습니다."

    if (response.status === 429 || errorCode === "RATE_LIMIT_EXCEEDED") {
      const retryAfter = Number.parseInt(String(response.headers.get("retry-after") || ""), 10)
      const retryAfterMessage = Number.isFinite(retryAfter) && retryAfter > 0
        ? `요청이 많아 일시 제한되었습니다. ${retryAfter}초 후 다시 시도해주세요.`
        : mapChatApiErrorMessage(errorCode, errorText)
      throw createChatApiError(retryAfterMessage, errorCode, traceId)
    }

    throw createChatApiError(mapChatApiErrorMessage(errorCode, errorText), errorCode, traceId)
  }

  const explicitErrorCode = typeof data.error_code === "string"
    ? data.error_code.trim()
    : headerErrorCode
  if (typeof data.error === "string" && data.error.trim()) {
    throw createChatApiError(
      mapChatApiErrorMessage(explicitErrorCode, data.error),
      explicitErrorCode || "UPSTREAM_RESPONSE_ERROR",
      traceId,
    )
  }
  if (explicitErrorCode) {
    throw createChatApiError(
      mapChatApiErrorMessage(explicitErrorCode, "AI 서버 처리 중 오류가 발생했습니다."),
      explicitErrorCode,
      traceId,
    )
  }

  const message = parseMessageFromResponse(data)
  if (!message) {
    throw createChatApiError(
      "AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해주세요.",
      "UPSTREAM_INVALID_FORMAT",
      traceId,
    )
  }

  const cachedContent = typeof data.cachedContent === "string"
    ? data.cachedContent.trim()
    : data.cachedContent === null
      ? null
      : null

  return {
    message,
    cachedContent: cachedContent && cachedContent.length > 0 ? cachedContent : null,
    trace_id: traceId,
  }
}
