import type { Character, Message } from "@/lib/data"
import { CHARACTERS } from "@/lib/data"
import { getStoredItem, removeStoredItem, setStoredItem } from "@/lib/browserStorage"
import { createGreetingMessage } from "@/lib/chat/greetingMessage"
import { toMessageContent, toPreviewText, toTruncatedPreview } from "@/lib/chat/historyContent"
import type { HistoryPreview, RecentChatItem } from "@/lib/chat/historyTypes"
import { devWarn } from "@/lib/logger"

const LOCAL_HISTORY_KEY_PREFIX = "chat_history_"

const getLocalHistoryKey = (characterId: string) => `${LOCAL_HISTORY_KEY_PREFIX}${characterId}`

const withGreeting = (messages: Message[], character: Character): Message[] => {
  const greeting = createGreetingMessage(character)
  if (messages.length === 0) {
    return [greeting]
  }

  if (messages[0].id === "greeting") {
    const next = [...messages]
    next[0] = greeting
    return next
  }

  return [greeting, ...messages]
}

const toPersistableMessages = (messages: Message[]): Message[] =>
  messages.filter((message) => message.id !== "greeting")

export const readGuestHistory = (character: Character): Message[] => {
  const localKey = getLocalHistoryKey(character.id)
  const saved = getStoredItem(localKey)
  if (!saved) {
    return [createGreetingMessage(character)]
  }

  try {
    const parsed = JSON.parse(saved)
    if (!Array.isArray(parsed)) {
      return [createGreetingMessage(character)]
    }

    const normalized = parsed
      .map((message): Message | null => {
        if (!message || typeof message !== "object") {
          return null
        }
        const msg = message as Partial<Message>
        if (msg.role !== "user" && msg.role !== "assistant") {
          return null
        }

        return {
          id: String(msg.id || Date.now()),
          role: msg.role,
          content: toMessageContent(msg.content, msg.role),
          timestamp: typeof msg.timestamp === "string" ? msg.timestamp : undefined,
        }
      })
      .filter((message): message is Message => Boolean(message))

    return withGreeting(normalized, character)
  } catch (error) {
    devWarn(`[V-MATE] Failed to parse guest history for ${character.id}`, error)
    return [createGreetingMessage(character)]
  }
}

export const writeGuestHistory = (characterId: string, messages: Message[]) => {
  const localKey = getLocalHistoryKey(characterId)
  setStoredItem(localKey, JSON.stringify(toPersistableMessages(messages)))
}

export const clearGuestHistory = (characterId: string) => {
  removeStoredItem(getLocalHistoryKey(characterId))
}

export const loadGuestHistoryPreviews = (): Record<string, HistoryPreview> => {
  const previews: Record<string, HistoryPreview> = {}

  Object.values(CHARACTERS).forEach((character) => {
    const localKey = getLocalHistoryKey(character.id)
    const saved = getStoredItem(localKey)
    if (!saved) {
      return
    }

    try {
      const parsed = JSON.parse(saved) as Message[]
      const last = parsed[parsed.length - 1]
      if (!last) {
        return
      }

      previews[character.id] = {
        text: toTruncatedPreview(toPreviewText(toMessageContent(last.content, last.role))),
        updatedAt: last.timestamp || null,
        hasHistory: true,
      }
    } catch (error) {
      devWarn(`[V-MATE] Failed to parse guest preview for ${character.id}`, error)
    }
  })

  return previews
}

export const loadGuestRecentChats = (): RecentChatItem[] => {
  const recentItems: RecentChatItem[] = []

  Object.values(CHARACTERS).forEach((character) => {
    const localKey = getLocalHistoryKey(character.id)
    const saved = getStoredItem(localKey)
    if (!saved) {
      return
    }

    try {
      const parsed = JSON.parse(saved) as Message[]
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return
      }
      const last = parsed[parsed.length - 1]
      const preview = toTruncatedPreview(toPreviewText(toMessageContent(last.content, last.role)), 42)
      if (!preview) {
        return
      }

      recentItems.push({
        characterId: character.id,
        preview,
        updatedAt: typeof last.timestamp === "string" ? last.timestamp : null,
      })
    } catch (error) {
      devWarn(`[V-MATE] Failed to parse guest recent chats for ${character.id}`, error)
    }
  })

  recentItems.sort((a, b) => {
    const dateA = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const dateB = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return dateB - dateA
  })

  return recentItems
}
