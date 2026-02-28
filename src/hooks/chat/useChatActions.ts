import { useCallback, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from "react"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { toast } from "sonner"
import type { Character, Message } from "@/lib/data"
import { createChatApiError, sendChatMessage } from "@/lib/chat/apiClient"
import {
  clearChatHistory,
  getPromptCacheKey,
  saveChatMessage,
  type HistoryPreview,
} from "@/lib/chat/historyRepository"
import { readPromptCache, removePromptCache, writePromptCache } from "@/lib/chat/promptCacheStore"
import { createGreetingMessage } from "@/lib/chat/greetingMessage"
import { buildPersonaErrorResponse } from "@/lib/chat/errorPersona"
import { CHAT_REQUEST_LIMITS } from "@/lib/chat/chatContract"
import { devError } from "@/lib/logger"

interface UseChatActionsParams {
  character: Character
  user: SupabaseUser | null
  inputValue: string
  isLoading: boolean
  setMessages: Dispatch<SetStateAction<Message[]>>
  setInputValue: Dispatch<SetStateAction<string>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setHistoryPreviews: Dispatch<SetStateAction<Record<string, HistoryPreview>>>
  messagesRef: RefObject<Message[]>
  messageInputRef: RefObject<HTMLTextAreaElement>
  beginRequest: (targetCharacterId: string) => { requestId: number; controller: AbortController }
  isRequestStale: (requestId: number, targetCharacterId: string) => boolean
  finishRequest: (requestId: number) => void
  abortInFlight: () => void
}

export const useChatActions = ({
  character,
  user,
  inputValue,
  isLoading,
  setMessages,
  setInputValue,
  setIsLoading,
  setHistoryPreviews,
  messagesRef,
  messageInputRef,
  beginRequest,
  isRequestStale,
  finishRequest,
  abortInFlight,
}: UseChatActionsParams) => {
  const resolveAccessToken = useCallback(async () => {
    if (!user) {
      throw createChatApiError("채팅은 로그인 후 이용할 수 있습니다.", "AUTH_REQUIRED")
    }

    const supabaseModule = await import("@/lib/supabase")
    if (!supabaseModule.isSupabaseConfigured()) {
      throw createChatApiError("인증 서버 설정이 완료되지 않았습니다.", "AUTH_PROVIDER_NOT_CONFIGURED")
    }

    const supabase = await supabaseModule.resolveSupabaseClient()
    if (!supabase) {
      throw createChatApiError("인증 클라이언트를 초기화하지 못했습니다.", "AUTH_PROVIDER_NOT_CONFIGURED")
    }

    const { data, error } = await supabase.auth.getSession()
    if (error || !data?.session?.access_token) {
      throw createChatApiError("로그인 세션이 만료되었습니다. 다시 로그인해주세요.", "AUTH_UNAUTHORIZED")
    }

    return data.session.access_token
  }, [user])

  const handleSendMessage = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isLoading) return

    if (!user) {
      toast.error("채팅은 로그인 후 이용할 수 있습니다.")
      return
    }

    const requestCharacterId = character.id
    const { requestId, controller } = beginRequest(requestCharacterId)
    const timeoutId = setTimeout(() => controller.abort(), 17000)
    const baselineMessages = messagesRef.current || []

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    }
    setMessages((prev) => [...prev, userMessage])

    if (user) {
      void saveChatMessage({
        user,
        message: userMessage,
        characterId: requestCharacterId,
      })
    }

    setInputValue("")
    setIsLoading(true)

    try {
      const messageHistory = baselineMessages
        .filter((msg) => msg.id !== "greeting")
        .map((msg) => ({
          role: msg.role,
          content: typeof msg.content === "string" ? msg.content : msg.content.response,
        }))
        .slice(-CHAT_REQUEST_LIMITS.frontendHistoryMaxItems)

      if (isRequestStale(requestId, requestCharacterId)) {
        return
      }

      const cacheStorageKey = getPromptCacheKey(requestCharacterId)
      const cachedContent = readPromptCache(cacheStorageKey)
      const clientRequestId = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const accessToken = await resolveAccessToken()
      const { message, cachedContent: nextCachedContent } = await sendChatMessage({
        payload: {
          characterId: requestCharacterId,
          userMessage: text,
          messageHistory,
          cachedContent,
          clientRequestId,
        },
        signal: controller.signal,
        accessToken,
      })

      if (isRequestStale(requestId, requestCharacterId)) {
        return
      }

      if (nextCachedContent) {
        writePromptCache(cacheStorageKey, nextCachedContent)
      } else {
        removePromptCache(cacheStorageKey)
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: message,
      }
      setMessages((prev) => [...prev, assistantMessage])

      if (user) {
        void saveChatMessage({
          user,
          message: assistantMessage,
          characterId: requestCharacterId,
        })
      }
    } catch (error) {
      if (isRequestStale(requestId, requestCharacterId)) {
        return
      }

      const { response: parsed, errorCode, traceId, errorMessage: personaErrorMessage } = buildPersonaErrorResponse({
        characterId: requestCharacterId,
        error,
      })

      if (errorCode) {
        devError("[V-MATE] Chat request failed", {
          characterId: requestCharacterId,
          errorCode,
          traceId: traceId || null,
          message: personaErrorMessage,
        })
      }

      const assistantErrorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: parsed,
      }
      setMessages((prev) => [...prev, assistantErrorMessage])
      if (errorCode === "AUTH_REQUIRED" || errorCode === "AUTH_UNAUTHORIZED") {
        toast.error("로그인 상태를 확인해주세요.")
      }
    } finally {
      clearTimeout(timeoutId)
      const shouldUnsetLoading = !isRequestStale(requestId, requestCharacterId)
      finishRequest(requestId)
      if (shouldUnsetLoading) {
        setIsLoading(false)
      }
    }
  }, [beginRequest, character.id, finishRequest, inputValue, isLoading, isRequestStale, messagesRef, resolveAccessToken, setInputValue, setIsLoading, setMessages, user])

  const handleClearChat = useCallback(async () => {
    if (!user) {
      toast.error("로그인 후 대화를 관리할 수 있습니다.")
      return false
    }

    abortInFlight()
    setIsLoading(false)

    try {
      await clearChatHistory({
        user,
        characterId: character.id,
      })
      removePromptCache(getPromptCacheKey(character.id))
    } catch (error) {
      devError("Failed to clear chat", error)
      toast.error("대화 초기화에 실패했습니다. 다시 시도해주세요.")
      return false
    }

    setInputValue("")
    setMessages([createGreetingMessage(character)])
    setHistoryPreviews((prev) => {
      if (!prev[character.id]) {
        return prev
      }

      const next = { ...prev }
      delete next[character.id]
      return next
    })
    return true
  }, [abortInFlight, character, setHistoryPreviews, setInputValue, setIsLoading, setMessages, user])

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return
    }

    event.preventDefault()
    void handleSendMessage()
  }, [handleSendMessage])

  const handleQuickReplyClick = useCallback((template: string) => {
    setInputValue(template)
    requestAnimationFrame(() => {
      messageInputRef.current?.focus()
    })
  }, [messageInputRef, setInputValue])

  return {
    handleSendMessage,
    handleClearChat,
    handleInputKeyDown,
    handleQuickReplyClick,
  }
}
