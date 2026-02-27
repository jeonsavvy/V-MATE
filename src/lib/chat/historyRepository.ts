import type { User as SupabaseUser } from "@supabase/supabase-js"
import type { Character, Message } from "@/lib/data"
import { loadGuestHistoryPreviews, loadGuestRecentChats, readGuestHistory, writeGuestHistory, clearGuestHistory } from "@/lib/chat/historyGuestStore"
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
  writeGuestHistory(characterId, messages)
}

export const loadChatHistory = async ({
  user,
  character,
}: {
  user: SupabaseUser | null
  character: Character
}): Promise<Message[]> => {
  if (!user) {
    return readGuestHistory(character)
  }

  const store = await resolveSupabaseHistoryStore()
  if (!store) {
    return readGuestHistory(character)
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
    clearGuestHistory(characterId)
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
    return loadGuestHistoryPreviews()
  }

  const store = await resolveSupabaseHistoryStore()
  if (!store) {
    return loadGuestHistoryPreviews()
  }

  return store.loadSupabaseHistoryPreviews({ user })
}

export const loadRecentChats = async ({
  user,
}: {
  user: SupabaseUser | null
}) => {
  if (!user) {
    return loadGuestRecentChats()
  }

  const store = await resolveSupabaseHistoryStore()
  if (!store) {
    return loadGuestRecentChats()
  }

  return store.loadSupabaseRecentChats({ user })
}
