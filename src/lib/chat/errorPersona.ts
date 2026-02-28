import type { AIResponse } from "@/lib/data"
import type { CharacterId } from "@/lib/data"
import type { ChatApiError } from "@/lib/chat/apiClient"
import { CONFIGURATION_ERROR_CODES, NETWORK_ERROR_CODES, REQUEST_POLICY_ERROR_CODES } from "@/lib/chat/apiClient"

interface BuildPersonaErrorResponseParams {
  characterId: CharacterId
  error: unknown
}

const toTraceSuffix = (traceId: string) => (traceId ? ` (trace: ${traceId})` : "")

const toErrorContext = (error: unknown) => {
  const typedError = error as ChatApiError
  const errorCode = typeof typedError?.chatErrorCode === "string" ? typedError.chatErrorCode : ""
  const traceId = typeof typedError?.chatTraceId === "string" ? typedError.chatTraceId : ""
  const errorMessage = typedError instanceof Error ? typedError.message : "알 수 없는 오류가 발생했습니다."

  return {
    errorCode,
    traceId,
    errorMessage,
    traceSuffix: toTraceSuffix(traceId),
  }
}

const buildNetworkError = (characterId: CharacterId, traceSuffix: string): AIResponse => ({
  emotion: "normal",
  inner_heart:
    characterId === "mika"
      ? "서버 연결이 흔들려서 답장을 못 만들었어..."
      : characterId === "alice"
        ? "상류 모델 연결이 불안정하군."
        : "서버 연결 불안정.",
  response:
    characterId === "mika"
      ? `선생님, 지금 AI 서버 연결이 불안정해서 답장을 만들지 못했어. 잠깐 뒤에 다시 시도해줘.${traceSuffix}`
      : characterId === "alice"
        ? `현재 AI 서버 연결이 불안정하여 응답 생성에 실패했다. 잠시 후 다시 시도해달라.${traceSuffix}`
        : `지금 AI 서버 연결이 불안정해서 답장 생성 실패. 잠깐 뒤에 다시 시도해줘.${traceSuffix}`,
})

const buildLocationError = (characterId: CharacterId, traceSuffix: string): AIResponse => ({
  emotion: "normal",
  inner_heart:
    characterId === "mika"
      ? "서버 지역 정책 때문에 호출이 막혔어..."
      : characterId === "alice"
        ? "현재 배포 지역 정책으로 호출이 제한되는군."
        : "서버 지역 정책으로 차단됨.",
  response:
    characterId === "mika"
      ? `선생님, 지금 서버 지역에서는 AI 호출이 제한돼. 관리자에게 배포 지역 변경이나 모델 전환을 요청해줘.${traceSuffix}`
      : characterId === "alice"
        ? `현재 서버 지역에서는 Gemini API 호출이 제한된다. 관리자에게 배포 지역 변경 또는 모델 전환을 요청해달라.${traceSuffix}`
        : `지금 서버 지역에서 Gemini 호출 제한됨. 관리자에게 지역/모델 변경 요청해줘.${traceSuffix}`,
})

const buildFormatError = (characterId: CharacterId, traceSuffix: string): AIResponse => ({
  emotion: "normal",
  inner_heart:
    characterId === "mika"
      ? "응답 포맷이 깨져서 지금은 안전하게 멈추는 게 맞아..."
      : characterId === "alice"
        ? "응답 계약(JSON) 파싱에 실패했다."
        : "응답 포맷 깨짐.",
  response:
    characterId === "mika"
      ? `선생님, 방금 AI 응답 형식이 깨져서 처리에 실패했어. 한 번만 다시 시도해줘.${traceSuffix}`
      : characterId === "alice"
        ? `AI 응답 형식 오류로 처리에 실패했다. 잠시 후 다시 시도해달라.${traceSuffix}`
        : `AI 응답 형식 오류로 처리 실패. 잠깐 뒤에 다시 시도해줘.${traceSuffix}`,
})

const buildApiKeyError = (characterId: CharacterId, traceSuffix: string): AIResponse => ({
  emotion: "normal",
  inner_heart: "서버 쪽에 문제가 있는 것 같다...",
  response:
    characterId === "mika"
      ? `선생님, 서버 API 키 설정에 문제가 있어 보여. 관리자에게 확인 요청해줘.${traceSuffix}`
      : characterId === "alice"
        ? `API 키 설정 오류로 요청이 거절되었다. 관리자에게 확인을 요청해달라.${traceSuffix}`
      : `서버 API 키 설정 문제로 요청 실패. 관리자 확인 필요.${traceSuffix}`,
})

const buildAuthError = (characterId: CharacterId, traceSuffix: string, isSessionExpired: boolean): AIResponse => ({
  emotion: "normal",
  inner_heart:
    characterId === "mika"
      ? "로그인이 필요한 상태야..."
      : characterId === "alice"
        ? "인증 상태를 다시 확인해야 한다."
        : "인증 필요.",
  response:
    characterId === "mika"
      ? isSessionExpired
        ? `선생님, 로그인 세션이 만료됐어. 다시 로그인해줘.${traceSuffix}`
        : `선생님, 채팅은 로그인 후에 이용할 수 있어.${traceSuffix}`
      : characterId === "alice"
        ? isSessionExpired
          ? `로그인 세션이 만료되었다. 다시 로그인해달라.${traceSuffix}`
          : `채팅 기능은 로그인 이후 사용할 수 있다.${traceSuffix}`
        : isSessionExpired
          ? `로그인 세션 만료됨. 다시 로그인해줘.${traceSuffix}`
          : `채팅은 로그인 후 이용 가능해.${traceSuffix}`,
})

const buildTimeoutError = (characterId: CharacterId, traceSuffix: string): AIResponse => ({
  emotion: "normal",
  inner_heart: "시간이 오래 걸리는구나...",
  response:
    characterId === "mika"
      ? `선생님, 응답 시간이 초과됐어. 잠깐 뒤에 다시 시도해줘.${traceSuffix}`
      : characterId === "alice"
        ? `응답 지연으로 요청이 종료되었다. 잠시 후 다시 시도해달라.${traceSuffix}`
        : `응답 시간 초과로 요청 종료. 잠깐 뒤 다시 시도해줘.${traceSuffix}`,
})

const buildConfigurationError = (characterId: CharacterId, traceSuffix: string): AIResponse => ({
  emotion: "normal",
  inner_heart: "서버 설정 이슈가 있는 것 같다.",
  response:
    characterId === "mika"
      ? `선생님, 서버 설정 문제로 답장을 만들지 못했어. 관리자 확인이 필요해.${traceSuffix}`
      : characterId === "alice"
        ? `서버 설정 문제로 요청에 실패했다. 관리자 확인이 필요하다.${traceSuffix}`
      : `서버 설정 문제로 요청 실패. 관리자 확인 필요.${traceSuffix}`,
})

const buildPolicyError = (characterId: CharacterId, traceSuffix: string): AIResponse => ({
  emotion: "normal",
  inner_heart:
    characterId === "mika"
      ? "요청 정책 때문에 지금은 진행할 수 없어..."
      : characterId === "alice"
        ? "요청 정책 검증에서 차단되었다."
        : "요청 정책으로 차단됨.",
  response:
    characterId === "mika"
      ? `선생님, 요청 형식이나 접속 경로 때문에 서버가 요청을 거절했어. 앱을 새로고침하고 다시 시도해줘.${traceSuffix}`
      : characterId === "alice"
        ? `요청 정책 검증에 실패했다. 요청 형식/접속 경로를 점검한 뒤 다시 시도해달라.${traceSuffix}`
        : `요청 정책 검증 실패. 새로고침 후 다시 시도해줘.${traceSuffix}`,
})

const buildFallbackError = (characterId: CharacterId, traceSuffix: string): AIResponse => ({
  emotion: "normal",
  inner_heart:
    characterId === "mika"
      ? "뭔가 이상한데... 선생님한테는 보여주고 싶지 않은데..."
      : characterId === "alice"
        ? "오류가 발생했다. 다시 시도해보자."
        : "어? 뭔가 이상한데...",
  response:
    characterId === "mika"
      ? `선생님, 예상치 못한 오류가 발생했어. 잠시 후 다시 시도해줘.${traceSuffix}`
      : characterId === "alice"
        ? `예상치 못한 오류가 발생했다. 잠시 후 다시 시도해달라.${traceSuffix}`
        : `예상치 못한 오류 발생. 잠시 후 다시 시도해줘.${traceSuffix}`,
})

export const buildPersonaErrorResponse = ({
  characterId,
  error,
}: BuildPersonaErrorResponseParams): { response: AIResponse; errorCode: string; traceId: string; errorMessage: string } => {
  const context = toErrorContext(error)
  const isAuthRequired = context.errorCode === "AUTH_REQUIRED"
  const isAuthUnauthorized = context.errorCode === "AUTH_UNAUTHORIZED"

  if (
    NETWORK_ERROR_CODES.has(context.errorCode) ||
    context.errorMessage.includes("네트워크") ||
    context.errorMessage.includes("연결")
  ) {
    return { ...context, response: buildNetworkError(characterId, context.traceSuffix) }
  }

  if (
    context.errorCode === "UPSTREAM_LOCATION_UNSUPPORTED" ||
    context.errorMessage.includes("서버 지역") ||
    context.errorMessage.includes("location is not supported")
  ) {
    return { ...context, response: buildLocationError(characterId, context.traceSuffix) }
  }

  if (
    context.errorCode === "UPSTREAM_INVALID_FORMAT" ||
    context.errorCode === "UPSTREAM_INVALID_RESPONSE" ||
    context.errorMessage.includes("응답 형식")
  ) {
    return { ...context, response: buildFormatError(characterId, context.traceSuffix) }
  }

  if (isAuthRequired || isAuthUnauthorized) {
    return {
      ...context,
      response: buildAuthError(characterId, context.traceSuffix, isAuthUnauthorized),
    }
  }

  if (
    context.errorCode === "SERVER_API_KEY_NOT_CONFIGURED" ||
    context.errorMessage.includes("API 키") ||
    context.errorMessage.includes("API key") ||
    context.errorMessage.includes("API_KEY") ||
    context.errorMessage.includes("GOOGLE_API_KEY")
  ) {
    return { ...context, response: buildApiKeyError(characterId, context.traceSuffix) }
  }

  if (context.errorMessage.includes("시간이 초과")) {
    return { ...context, response: buildTimeoutError(characterId, context.traceSuffix) }
  }

  if (CONFIGURATION_ERROR_CODES.has(context.errorCode)) {
    return { ...context, response: buildConfigurationError(characterId, context.traceSuffix) }
  }

  if (REQUEST_POLICY_ERROR_CODES.has(context.errorCode)) {
    return { ...context, response: buildPolicyError(characterId, context.traceSuffix) }
  }

  return { ...context, response: buildFallbackError(characterId, context.traceSuffix) }
}
