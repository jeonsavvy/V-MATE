import type { CharacterId } from "@/lib/data"

export interface HistoryPreview {
  text: string
  updatedAt: string | null
  hasHistory: boolean
}

export interface RecentChatItem {
  characterId: CharacterId
  preview: string
  updatedAt: string | null
}

export interface ChatMessageRow {
  id: string | number
  role: "user" | "assistant"
  content: unknown
  created_at: string | null
  character_id: string
}
