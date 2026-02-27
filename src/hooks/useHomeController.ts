import { useEffect, useMemo, useState } from "react"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { toast } from "sonner"
import { CHARACTERS, type CharacterId } from "@/lib/data"
import { CHARACTER_UI_META, type CharacterFilter, CHARACTER_FILTERS } from "@/lib/character-ui"
import { loadRecentChats as loadRecentChatsFromRepository, type RecentChatItem } from "@/lib/chat/historyRepository"
import { devError } from "@/lib/logger"

export const HERO_SIGNALS = [
  "지금 가장 많이 이어진 대화",
  "감정선이 짙은 추천",
  "가볍게 시작하기 좋은 분위기",
]

export const STORY_FLOW_STEPS = [
  { title: "감정 시동", description: "캐릭터의 현재 무드로 대화를 시작해요." },
  { title: "관계 확장", description: "속마음·겉말 대비로 대화 밀도를 올려요." },
  { title: "장면 고정", description: "최근 대화 이어하기로 흐름을 유지해요." },
]

export const formatRelativeTime = (updatedAt: string | null): string => {
  if (!updatedAt) return "기록 없음"
  const diff = Date.now() - Date.parse(updatedAt)
  if (Number.isNaN(diff) || diff < 0) return "최근"

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < hour) {
    const value = Math.max(1, Math.floor(diff / minute))
    return `${value}분 전`
  }

  if (diff < day) {
    const value = Math.floor(diff / hour)
    return `${value}시간 전`
  }

  const value = Math.floor(diff / day)
  return `${value}일 전`
}

const toAvatarInitial = (user: SupabaseUser | null): string => {
  if (!user) {
    return "V"
  }

  const candidate = String(user.user_metadata?.name || user.email || "V").trim()
  if (!candidate) {
    return "V"
  }
  return candidate[0].toUpperCase()
}

export const useHomeController = ({ user }: { user: SupabaseUser | null }) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<CharacterFilter>("전체")
  const [selectedCharacterId, setSelectedCharacterId] = useState<CharacterId | null>(null)
  const [recentChats, setRecentChats] = useState<RecentChatItem[]>([])

  const characters = useMemo(() => Object.values(CHARACTERS), [])

  useEffect(() => {
    let isMounted = true

    const loadRecentChats = async () => {
      try {
        const recentItems = await loadRecentChatsFromRepository({ user })
        if (isMounted) {
          setRecentChats(recentItems)
        }
      } catch (error) {
        devError("Failed to load recent chats", error)
        if (isMounted) {
          setRecentChats([])
        }
      }
    }

    void loadRecentChats()

    return () => {
      isMounted = false
    }
  }, [user])

  const filteredCharacters = useMemo(() => {
    return characters.filter((char) => {
      const meta = CHARACTER_UI_META[char.id]
      const query = searchQuery.toLowerCase().trim()
      const matchesSearch =
        query.length === 0 ||
        char.name.toLowerCase().includes(query) ||
        meta.tags.some((tag) => tag.toLowerCase().includes(query)) ||
        meta.summary.toLowerCase().includes(query)
      const matchesFilter = activeFilter === "전체" || meta.filters.includes(activeFilter)
      return matchesSearch && matchesFilter
    })
  }, [activeFilter, characters, searchQuery])

  const heroCharacters = useMemo(() => filteredCharacters.slice(0, 3), [filteredCharacters])
  const primaryCharacter = heroCharacters[0] ?? filteredCharacters[0] ?? characters[0]
  const primaryCharacterMeta = primaryCharacter ? CHARACTER_UI_META[primaryCharacter.id] : null
  const recentContinuation = useMemo(() => recentChats.slice(0, 4), [recentChats])

  const selectedCharacter = selectedCharacterId ? CHARACTERS[selectedCharacterId] ?? null : null
  const selectedCharacterMeta = selectedCharacter ? CHARACTER_UI_META[selectedCharacter.id] : null
  const userAvatarInitial = useMemo(() => toAvatarInitial(user), [user])

  const handleSignOut = async () => {
    const supabaseModule = await import("@/lib/supabase")
    if (!supabaseModule.isSupabaseConfigured()) {
      toast.error("Supabase가 설정되지 않았습니다")
      return
    }

    const supabase = await supabaseModule.resolveSupabaseClient()
    if (!supabase) {
      toast.error("Supabase 클라이언트를 초기화하지 못했습니다")
      return
    }

    try {
      await supabase.auth.signOut()
      toast.success("로그아웃되었습니다")
    } catch (error) {
      devError("Sign out error:", error)
      toast.error("로그아웃 중 오류가 발생했습니다")
    }
  }

  return {
    searchQuery,
    setSearchQuery,
    activeFilter,
    setActiveFilter,
    selectedCharacterId,
    setSelectedCharacterId,
    recentChats,
    filteredCharacters,
    heroCharacters,
    primaryCharacter,
    primaryCharacterMeta,
    recentContinuation,
    selectedCharacter,
    selectedCharacterMeta,
    userAvatarInitial,
    handleSignOut,
    characterFilters: CHARACTER_FILTERS,
  }
}
