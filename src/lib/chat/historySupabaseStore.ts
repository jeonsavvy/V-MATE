import type { User as SupabaseUser } from "@supabase/supabase-js"
import type { Character, CharacterId, Message } from "@/lib/data"
import { CHARACTERS, isCharacterId } from "@/lib/data"
import { createGreetingMessage } from "@/lib/chat/greetingMessage"
import { parseSavedContentToPreview, toMessageContent, toTruncatedPreview } from "@/lib/chat/historyContent"
import type { ChatMessageRow, HistoryPreview, RecentChatItem } from "@/lib/chat/historyTypes"
import { devWarn } from "@/lib/logger"

const PREVIEW_SCAN_LIMIT = 500
const RECENT_SCAN_LIMIT = 500
const TARGET_RECENT_CHAT_COUNT = Object.keys(CHARACTERS).length

const resolveSupabaseClient = async () => {
  const module = await import("@/lib/supabase")
  if (!module.isSupabaseConfigured()) {
    return null
  }
  return module.resolveSupabaseClient()
}

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

export const loadSupabaseChatHistory = async ({
  user,
  character,
}: {
  user: SupabaseUser
  character: Character
}): Promise<Message[]> => {
  const supabase = await resolveSupabaseClient()
  if (!supabase) {
    return [createGreetingMessage(character)]
  }

  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, created_at, character_id")
      .eq("user_id", user.id)
      .eq("character_id", character.id)
      .order("created_at", { ascending: true })

    if (error) {
      throw error
    }

    const messages = (data as ChatMessageRow[] | null)?.map((row) => ({
      id: String(row.id),
      role: row.role,
      content: toMessageContent(row.content, row.role),
      timestamp: row.created_at || undefined,
    })) ?? []

    return withGreeting(messages, character)
  } catch (error) {
    devWarn(`[V-MATE] Failed to load Supabase history for ${character.id}`, error)
    return [createGreetingMessage(character)]
  }
}

export const saveSupabaseChatMessage = async ({
  user,
  message,
  characterId,
}: {
  user: SupabaseUser
  message: Message
  characterId: string
}) => {
  const supabase = await resolveSupabaseClient()
  if (!supabase) {
    return
  }

  const payload = typeof message.content === "string"
    ? { text: message.content }
    : message.content

  try {
    const { error } = await supabase.from("chat_messages").insert({
      user_id: user.id,
      character_id: characterId,
      role: message.role,
      content: payload,
    })

    if (error) {
      throw error
    }
  } catch (error) {
    devWarn(`[V-MATE] Failed to save message for ${characterId}`, error)
  }
}

export const clearSupabaseChatHistory = async ({
  user,
  characterId,
}: {
  user: SupabaseUser
  characterId: string
}) => {
  const supabase = await resolveSupabaseClient()
  if (!supabase) {
    return
  }

  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("user_id", user.id)
    .eq("character_id", characterId)

  if (error) {
    throw error
  }
}

export const loadSupabaseHistoryPreviews = async ({
  user,
}: {
  user: SupabaseUser
}): Promise<Record<string, HistoryPreview>> => {
  const previews: Record<string, HistoryPreview> = {}
  const supabase = await resolveSupabaseClient()
  if (!supabase) {
    return previews
  }

  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("character_id, content, created_at, role")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(PREVIEW_SCAN_LIMIT)

    if (error) {
      throw error
    }

    for (const row of (data as Pick<ChatMessageRow, "character_id" | "content" | "created_at" | "role">[] | null) || []) {
      const characterId = String(row.character_id || "")
      if (!isCharacterId(characterId)) {
        continue
      }
      if (previews[characterId]) {
        continue
      }

      const previewText = toTruncatedPreview(parseSavedContentToPreview(row.content))
      if (!previewText) {
        continue
      }

      previews[characterId] = {
        text: previewText,
        updatedAt: row.created_at || null,
        hasHistory: true,
      }

      if (Object.keys(previews).length >= TARGET_RECENT_CHAT_COUNT) {
        break
      }
    }

    return previews
  } catch (error) {
    devWarn("[V-MATE] Failed to load Supabase history previews", error)
    return previews
  }
}

export const loadSupabaseRecentChats = async ({
  user,
}: {
  user: SupabaseUser
}): Promise<RecentChatItem[]> => {
  const supabase = await resolveSupabaseClient()
  if (!supabase) {
    return []
  }

  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("character_id, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_SCAN_LIMIT)

    if (error) {
      throw error
    }

    const map = new Map<CharacterId, RecentChatItem>()
    for (const row of (data as Pick<ChatMessageRow, "character_id" | "content" | "created_at">[] | null) || []) {
      const characterId = String(row.character_id || "")
      if (!isCharacterId(characterId) || map.has(characterId)) {
        continue
      }

      const preview = toTruncatedPreview(parseSavedContentToPreview(row.content), 42)
      if (!preview) {
        continue
      }

      map.set(characterId, {
        characterId,
        preview,
        updatedAt: row.created_at || null,
      })

      if (map.size >= TARGET_RECENT_CHAT_COUNT) {
        break
      }
    }

    return Array.from(map.values())
  } catch (error) {
    devWarn("[V-MATE] Failed to load recent chats from Supabase", error)
    return []
  }
}
