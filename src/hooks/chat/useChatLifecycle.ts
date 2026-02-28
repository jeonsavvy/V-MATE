import { useEffect, useRef, type Dispatch, type SetStateAction } from "react"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import type { Character, Message } from "@/lib/data"
import {
  loadChatHistory,
  loadHistoryPreviews as loadHistoryPreviewsFromRepository,
  toPreviewText,
  toTruncatedPreview,
  type HistoryPreview,
} from "@/lib/chat/historyRepository"
import { devError } from "@/lib/logger"

interface UseChatLifecycleParams {
  user: SupabaseUser | null
  character: Character
  messages: Message[]
  setMessages: Dispatch<SetStateAction<Message[]>>
  setHistoryPreviews: Dispatch<SetStateAction<Record<string, HistoryPreview>>>
}

export const useChatLifecycle = ({
  user,
  character,
  messages,
  setMessages,
  setHistoryPreviews,
}: UseChatLifecycleParams) => {
  const isLoadingHistoryRef = useRef(false)
  const messagesRef = useRef(messages)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    let isMounted = true

    const loadHistory = async () => {
      isLoadingHistoryRef.current = true

      try {
        const nextMessages = await loadChatHistory({ user, character })
        if (isMounted) {
          setMessages(nextMessages)
        }
      } catch (error) {
        devError("Failed to load chat history", error)
      } finally {
        isLoadingHistoryRef.current = false
      }
    }

    void loadHistory()

    return () => {
      isMounted = false
    }
  }, [character, setMessages, user])

  useEffect(() => {
    let isMounted = true

    const loadPreviews = async () => {
      try {
        const previews = await loadHistoryPreviewsFromRepository({ user })
        if (isMounted) {
          setHistoryPreviews(previews)
        }
      } catch (error) {
        devError("Failed to load history previews", error)
        if (isMounted) {
          setHistoryPreviews({})
        }
      }
    }

    void loadPreviews()

    return () => {
      isMounted = false
    }
  }, [setHistoryPreviews, user])

  useEffect(() => {
    if (messages.length <= 1) {
      setHistoryPreviews((prev) => {
        if (!prev[character.id]) {
          return prev
        }

        const next = { ...prev }
        delete next[character.id]
        return next
      })
      return
    }

    const latestMessage = messages[messages.length - 1]
    const latestText = toTruncatedPreview(toPreviewText(latestMessage.content))
    if (!latestText) {
      return
    }

    setHistoryPreviews((prev) => ({
      ...prev,
      [character.id]: {
        text: latestText,
        updatedAt: new Date().toISOString(),
        hasHistory: true,
      },
    }))
  }, [character.id, messages, setHistoryPreviews])

  return {
    messagesRef,
  }
}
