import type { User as SupabaseUser } from "@supabase/supabase-js"
import type { Character, Message } from "@/lib/data"
import { createGreetingMessage } from "@/lib/chat/greetingMessage"
import { devWarn } from "@/lib/logger"

const PROMPT_CACHE_KEY_PREFIX = "gemini_cached_content_"
let supabaseHistoryStorePromise: Promise<typeof import("@/lib/chat/historySupabaseStore") | null> | null = null

const resolveSupabaseHistoryStore = async () => {
  if (!supabaseHistoryStorePromise) {
    supabaseHistoryStorePromise = import("@/lib/chat/historySupabaseStore")
      .then((module) => module)
      .catch((error) => {
        devWarn("[V-MATE] Failed to load Supabase history store module", error)
        supabaseHistoryStorePromise = null
        return null
      })
  }

  return supabaseHistoryStorePromise
}

export { parseSavedContentToPreview, toPreviewText, toTruncatedPreview } from "@/lib/chat/historyContent"
export type { ChatMessageRow, HistoryPreview, RecentChatItem } from "@/lib/chat/historyTypes"

export const getPromptCacheKey = (characterId: string) => `${PROMPT_CACHE_KEY_PREFIX}${characterId}`

export const saveGuestHistory = (characterId: string, messages: Message[]) => {
  void characterId
  void messages
}

export const loadChatHistory = async ({
  user,
  character,
}: {
  user: SupabaseUser | null
  character: Character
}): Promise<Message[]> => {
  if (!user) {
    return [createGreetingMessage(character)]
  }

  const store = await resolveSupabaseHistoryStore()
  if (!store) {
    return [createGreetingMessage(character)]
  }

  return store.loadSupabaseChatHistory({
    user,
    character,
  })
}

export const saveChatMessage = async ({
  user,
  message,
  characterId,
}: {
  user: SupabaseUser | null
  message: Message
  characterId: string
}) => {
  if (!user) {
    return
  }

  const store = await resolveSupabaseHistoryStore()
  if (!store) {
    return
  }

  await store.saveSupabaseChatMessage({
    user,
    message,
    characterId,
  })
}

export const clearChatHistory = async ({
  user,
  characterId,
}: {
  user: SupabaseUser | null
  characterId: string
}) => {
  if (!user) {
    void characterId
    return
  }

  const store = await resolveSupabaseHistoryStore()
  if (!store) {
    return
  }

  await store.clearSupabaseChatHistory({
    user,
    characterId,
  })
}

export const loadHistoryPreviews = async ({
  user,
}: {
  user: SupabaseUser | null
}) => {
  if (!user) {
    return {}
  }

  const store = await resolveSupabaseHistoryStore()
  if (!store) {
    return {}
  }

  return store.loadSupabaseHistoryPreviews({ user })
}

export const loadRecentChats = async ({
  user,
}: {
  user: SupabaseUser | null
}) => {
  if (!user) {
    return []
  }

  const store = await resolveSupabaseHistoryStore()
  if (!store) {
    return []
  }

  return store.loadSupabaseRecentChats({ user })
}
