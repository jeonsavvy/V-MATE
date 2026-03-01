import { useEffect, useMemo, useState } from "react"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import type { AIResponse, Character, Message } from "@/lib/data"
import { useChatSession } from "@/hooks/useChatSession"
import { useChatLifecycle } from "@/hooks/chat/useChatLifecycle"
import { useChatViewport } from "@/hooks/chat/useChatViewport"
import { useChatActions } from "@/hooks/chat/useChatActions"
import { type HistoryPreview } from "@/lib/chat/historyRepository"
import { createGreetingMessage } from "@/lib/chat/greetingMessage"
import { getLatestAssistantPayload, prepareMessagesForRender } from "@/lib/chat/messagePresentation"
import { buildSidebarCharacterEntries } from "@/lib/chat/sidebarEntries"

export const useChatViewController = ({
  character,
  user,
}: {
  character: Character
  user: SupabaseUser | null
}) => {
  const [messages, setMessages] = useState<Message[]>([createGreetingMessage(character)])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [historyPreviews, setHistoryPreviews] = useState<Record<string, HistoryPreview>>({})
  const [showEmotionIllustrations, setShowEmotionIllustrations] = useState(true)
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false)

  const { beginRequest, isRequestStale, finishRequest, abortInFlight } = useChatSession(character.id)

  const { messagesRef } = useChatLifecycle({
    user,
    character,
    messages,
    setMessages,
    setHistoryPreviews,
  })

  const { scrollRef, messageInputRef } = useChatViewport({
    messages,
    inputValue,
  })

  useEffect(() => {
    setIsLoading(false)
    setMessages([createGreetingMessage(character)])
  }, [character])

  useEffect(() => {
    setIsInfoPanelOpen(false)
  }, [character.id])

  const {
    handleSendMessage,
    handleClearChat,
    handleInputKeyDown,
    handleQuickReplyClick,
  } = useChatActions({
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
  })

  const sidebarCharacterEntries = useMemo(
    () =>
      buildSidebarCharacterEntries({
        activeCharacterId: character.id,
        historyPreviews,
      }),
    [character.id, historyPreviews]
  )

  const preparedMessages = useMemo(() => {
    return prepareMessagesForRender({
      messages,
      character,
      showEmotionIllustrations,
    })
  }, [messages, showEmotionIllustrations, character])

  const latestAssistantPayload = getLatestAssistantPayload(messages)
  const activeEmotion: AIResponse["emotion"] = latestAssistantPayload?.emotion || "normal"

  return {
    messages,
    inputValue,
    setInputValue,
    isLoading,
    historyPreviews,
    showEmotionIllustrations,
    setShowEmotionIllustrations,
    isInfoPanelOpen,
    setIsInfoPanelOpen,
    scrollRef,
    messageInputRef,
    sidebarCharacterEntries,
    preparedMessages,
    activeEmotion,
    handleSendMessage,
    handleClearChat,
    handleInputKeyDown,
    handleQuickReplyClick,
  }
}
