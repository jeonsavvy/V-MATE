import type { Character } from "@/lib/data"
import { CHARACTERS } from "@/lib/data"
import { CHARACTER_UI_META } from "@/lib/character-ui"
import { toTruncatedPreview, type HistoryPreview } from "@/lib/chat/historyRepository"

export interface SidebarCharacterEntry {
  character: Character
  hasHistory: boolean
  updatedAt: string | null
  previewText: string
}

export const buildSidebarCharacterEntries = ({
  activeCharacterId,
  historyPreviews,
}: {
  activeCharacterId: string
  historyPreviews: Record<string, HistoryPreview>
}): SidebarCharacterEntry[] =>
  Object.values(CHARACTERS)
    .map((item) => {
      const preview = historyPreviews[item.id]
      const fallback = toTruncatedPreview(CHARACTER_UI_META[item.id]?.summary || "", 52)

      return {
        character: item,
        hasHistory: Boolean(preview?.hasHistory),
        updatedAt: preview?.updatedAt || null,
        previewText: preview?.text || fallback,
      }
    })
    .sort((a, b) => {
      if (a.character.id === activeCharacterId) return -1
      if (b.character.id === activeCharacterId) return 1
      if (a.hasHistory !== b.hasHistory) return a.hasHistory ? -1 : 1

      const dateA = a.updatedAt ? Date.parse(a.updatedAt) || 0 : 0
      const dateB = b.updatedAt ? Date.parse(b.updatedAt) || 0 : 0
      return dateB - dateA
    })
