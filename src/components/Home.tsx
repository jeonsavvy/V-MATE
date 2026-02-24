import { useEffect, useMemo, useState } from "react"
import { Character, CHARACTERS, Message } from "@/lib/data"
import { CHARACTER_FILTERS, CHARACTER_UI_META, CharacterFilter } from "@/lib/character-ui"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Search, LogOut, Sparkles, ArrowRight, Flame, Clock3 } from "lucide-react"
import { User as SupabaseUser } from "@supabase/supabase-js"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { CharacterDetailSheet } from "./CharacterDetailSheet"

interface HomeProps {
  onCharacterSelect: (character: Character) => void
  user: SupabaseUser | null
  onAuthRequest: () => void
}

interface RecentChatItem {
  characterId: string
  preview: string
  updatedAt: string | null
}

const toPreviewText = (content: Message["content"]): string => {
  if (typeof content === "string") {
    return content
  }
  return typeof content.response === "string" ? content.response : ""
}

const parseSavedContentToPreview = (content: unknown): string => {
  if (typeof content !== "string") {
    if (content && typeof content === "object" && typeof (content as any).response === "string") {
      return (content as any).response
    }
    return ""
  }

  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === "string") return parsed
    if (parsed && typeof parsed === "object" && typeof parsed.response === "string") {
      return parsed.response
    }
    return content
  } catch {
    return content
  }
}

const truncatePreview = (text: string, max = 42): string => {
  const normalized = String(text || "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}…`
}

const formatRelativeTime = (updatedAt: string | null): string => {
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

export function Home({ onCharacterSelect, user, onAuthRequest }: HomeProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<CharacterFilter>("전체")
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [recentChats, setRecentChats] = useState<RecentChatItem[]>([])

  const characters = useMemo(() => Object.values(CHARACTERS), [])

  useEffect(() => {
    const loadRecentChats = async () => {
      if (!user) {
        const localItems: RecentChatItem[] = []
        characters.forEach((char) => {
          const localKey = `chat_history_${char.id}`
          const saved = localStorage.getItem(localKey)
          if (!saved) return

          try {
            const parsed = JSON.parse(saved) as Message[]
            if (!Array.isArray(parsed) || parsed.length === 0) return
            const last = parsed[parsed.length - 1]
            const preview = truncatePreview(toPreviewText(last.content))
            if (!preview) return

            localItems.push({
              characterId: char.id,
              preview,
              updatedAt: last.timestamp || null,
            })
          } catch (error) {
            console.error(`Failed to load local recent chats for ${char.id}`, error)
          }
        })

        localItems.sort((a, b) => {
          const dateA = a.updatedAt ? Date.parse(a.updatedAt) : 0
          const dateB = b.updatedAt ? Date.parse(b.updatedAt) : 0
          return dateB - dateA
        })
        setRecentChats(localItems)
        return
      }

      if (!isSupabaseConfigured()) {
        setRecentChats([])
        return
      }

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          setRecentChats([])
          return
        }

        const { data, error } = await supabase
          .from('chat_messages')
          .select('character_id, content, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })

        if (error) throw error

        const map = new Map<string, RecentChatItem>()
        data?.forEach((row: any) => {
          const characterId = String(row.character_id || '')
          if (!CHARACTERS[characterId] || map.has(characterId)) {
            return
          }

          const preview = truncatePreview(parseSavedContentToPreview(row.content))
          if (!preview) return

          map.set(characterId, {
            characterId,
            preview,
            updatedAt: row.created_at || null,
          })
        })

        setRecentChats(Array.from(map.values()))
      } catch (error) {
        console.error("Failed to load recent chats", error)
        setRecentChats([])
      }
    }

    loadRecentChats()
  }, [user, characters])

  const filteredCharacters = characters.filter((char) => {
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

  const heroCharacters = filteredCharacters.slice(0, 3)
  const primaryCharacter = heroCharacters[0] ?? filteredCharacters[0] ?? characters[0]
  const primaryCharacterMeta = primaryCharacter ? CHARACTER_UI_META[primaryCharacter.id] : null
  const recentContinuation = recentChats.slice(0, 4)
  const heroSignals = ["지금 가장 많이 이어진 대화", "감정선이 짙은 추천", "가볍게 시작하기 좋은 분위기"]
  const selectedCharacter = selectedCharacterId ? CHARACTERS[selectedCharacterId] : null
  const selectedCharacterMeta = selectedCharacter ? CHARACTER_UI_META[selectedCharacter.id] : null

  const handleSignOut = async () => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase가 설정되지 않았습니다")
      return
    }
    try {
      await supabase.auth.signOut()
      toast.success("로그아웃되었습니다")
    } catch (error) {
      console.error("Sign out error:", error)
      toast.error("로그아웃 중 오류가 발생했습니다")
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#e8e1d5] pb-[calc(5rem+env(safe-area-inset-bottom))] text-[#1f2128]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(109,91,72,0.12),transparent_30%),radial-gradient(circle_at_85%_14%,rgba(116,108,139,0.18),transparent_34%),radial-gradient(circle_at_82%_80%,rgba(95,124,146,0.16),transparent_36%)]" />
        <div className="absolute -top-28 left-1/2 h-72 w-[34rem] -translate-x-1/2 rounded-full bg-[#d6cbba]/70 blur-[120px]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/40 bg-[#ece4d8]/80 px-4 py-3 shadow-[0_16px_34px_-30px_rgba(28,26,22,0.75)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1280px] items-center gap-3">
          <div className="shrink-0 text-2xl font-black tracking-tight text-[#7b5cb8]">V-MATE</div>

          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d756b]" />
            <Input
              placeholder="검색어를 입력해 주세요"
              className="h-10 rounded-full border-[#c8beaf] bg-white/75 pl-9 text-[#2a2b30] placeholder:text-[#847c72] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-all focus:border-[#8b6cc7] focus:bg-white"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="shrink-0">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="h-8 w-8 cursor-pointer rounded-full bg-gradient-to-tr from-[#9d8ab9] to-[#cba2bb] p-[2px]">
                    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white">
                      <img
                        src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`}
                        alt="User"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-[#cbc2b2] bg-[#f6f2eb]/98 text-[#21232a] shadow-[0_18px_35px_-26px_rgba(28,27,23,0.75)]">
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span>{user.user_metadata?.name || "사용자"}</span>
                      <span className="text-xs font-normal text-[#8f8b82]">{user.email}</span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-black/10" />
                  <DropdownMenuItem onClick={handleSignOut} className="text-red-500 focus:bg-red-500/10 focus:text-red-500">
                    <LogOut className="mr-2 h-4 w-4" />
                    로그아웃
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                onClick={onAuthRequest}
                className="h-10 rounded-full bg-[#7b5cb8] px-5 text-white shadow-[0_12px_24px_-16px_rgba(123,92,184,0.92)] transition hover:bg-[#6b4fa6]"
              >
                로그인
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1280px] space-y-10 px-4 py-5 md:py-6 lg:space-y-12">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          <div className="relative overflow-hidden rounded-[30px] border border-white/45 bg-black/40 shadow-[0_28px_54px_-32px_rgba(23,21,18,0.85)]">
            <img
              src={primaryCharacter.images.normal}
              alt={`${primaryCharacter.name} 대표 이미지`}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: primaryCharacterMeta?.heroObjectPosition || "center top" }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(20,17,23,0.88)_12%,rgba(20,17,23,0.45)_56%,rgba(20,17,23,0.25)_100%)]" />
            <div className="absolute -right-16 top-8 h-44 w-44 rounded-full bg-[#9a80d6]/35 blur-[70px]" />

            <div className="relative flex min-h-[290px] flex-col justify-end gap-4 p-6 text-white sm:min-h-[360px] sm:p-8">
              <span className="inline-flex w-fit items-center gap-1 rounded-full border border-white/35 bg-white/12 px-3 py-1 text-xs font-semibold tracking-[0.12em] text-white/90">
                <Sparkles className="h-3.5 w-3.5" />
                TODAY'S MOOD
              </span>
              <div className="space-y-2">
                <h1 className="max-w-2xl text-3xl font-black leading-tight text-white sm:text-4xl">
                  오늘은 어떤 감정선으로 대화를 시작할까요?
                </h1>
                <p className="max-w-xl text-sm leading-relaxed text-white/86 sm:text-base">
                  {primaryCharacterMeta?.heroQuote ?? primaryCharacter.greeting}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  onClick={() => onCharacterSelect(primaryCharacter)}
                  className="h-11 rounded-full bg-[#8d6bd2] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_-18px_rgba(141,107,210,0.92)] transition hover:bg-[#7d5dc2]"
                >
                  {primaryCharacter.name}와 대화 시작
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <button
                  type="button"
                  onClick={() => setSelectedCharacterId(primaryCharacter.id)}
                  className="inline-flex h-11 items-center rounded-full border border-white/50 bg-white/12 px-5 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  캐릭터 자세히 보기
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/45 bg-white/72 p-4 shadow-[0_20px_38px_-26px_rgba(23,21,18,0.78)] sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[#38352f]">
                <Clock3 className="h-4 w-4 text-[#7b5cb8]" />
                <p className="text-sm font-bold">지금 이어서 대화하기</p>
              </div>
              <p className="text-xs font-semibold text-[#746d63]">{recentChats.length}개 기록</p>
            </div>

            {recentContinuation.length > 0 ? (
              <div className="mt-4 space-y-2">
                {recentContinuation.map((item) => {
                  const char = CHARACTERS[item.characterId]
                  if (!char) return null
                  return (
                    <button
                      key={item.characterId}
                      onClick={() => onCharacterSelect(char)}
                      className="group flex w-full items-center gap-3 rounded-2xl border border-[#ece2d6] bg-white/86 p-3 text-left transition hover:border-[#d7c6ee] hover:bg-white"
                    >
                      <img src={char.images.normal} alt={char.name} className="h-12 w-12 rounded-xl object-cover object-top" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="truncate text-sm font-bold text-[#2f3138]">{char.name}</p>
                        <p className="truncate text-xs text-[#5d574d]">{item.preview}</p>
                        <p className="text-[11px] font-medium text-[#8a8378]">{formatRelativeTime(item.updatedAt)}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[#8c8579] transition group-hover:text-[#6d5b96]" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-[#d7ccbd] bg-[#f7f2ea] px-4 py-6 text-center text-sm text-[#6a645a]">
                아직 이어갈 대화가 없어요. 추천 캐릭터로 첫 대화를 시작해보세요.
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-[#8c8376]">CURATED PICKS</p>
              <h2 className="mt-1 text-2xl font-black text-[#252730] sm:text-[2rem]">추천 캐릭터</h2>
              <p className="mt-1 text-sm text-[#645d53]">감정선이 강한 캐릭터 중심으로 바로 몰입할 수 있게 큐레이션했어요.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/68 px-3 py-1.5 text-xs font-semibold text-[#5d574c]">
              <Flame className="h-3.5 w-3.5 text-[#7b5cb8]" />
              상세 보기 후 대화 시작
            </div>
          </div>

          {heroCharacters.length > 0 && (
            <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:overflow-visible md:px-0 md:pb-0 md:grid-cols-[1.45fr_1fr_1fr]">
              {heroCharacters.map((char, index) => {
                const meta = CHARACTER_UI_META[char.id]
                return (
                  <button
                    key={char.id}
                    onClick={() => setSelectedCharacterId(char.id)}
                    className="group relative min-h-[300px] w-[82vw] shrink-0 snap-center overflow-hidden rounded-3xl border border-white/45 text-left shadow-[0_22px_42px_-24px_rgba(22,20,18,0.82)] transition hover:-translate-y-1.5 hover:shadow-[0_30px_48px_-24px_rgba(22,20,18,0.9)] sm:w-[56vw] md:w-auto md:min-h-[340px]"
                  >
                    <img
                      src={char.images.normal}
                      alt={char.name}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      style={{ objectPosition: meta.heroObjectPosition || "center top" }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/86 via-black/35 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 space-y-2 p-5 text-white">
                      <p className="text-[11px] font-semibold tracking-[0.14em] text-white/85">{heroSignals[index] ?? "추천 캐릭터"}</p>
                      <h3 className="text-[1.7rem] font-black leading-tight">{char.name}</h3>
                      <p className="line-clamp-2 text-sm text-white/86">{meta.heroQuote ?? meta.summary}</p>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-white/90">
                        캐릭터 살펴보기
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-[#8c8376]">BROWSE</p>
              <h3 className="mt-1 text-2xl font-black text-[#252730]">캐릭터 모아보기</h3>
            </div>
            <p className="text-xs font-semibold text-[#756d62]">총 {filteredCharacters.length}개</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {CHARACTER_FILTERS.map((filter) => {
              const isActive = activeFilter === filter
              return (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition md:px-4 ${
                    isActive
                      ? "border-[#7b5cb8] bg-[#7b5cb8] text-white shadow-[0_10px_20px_-14px_rgba(123,92,184,0.95)]"
                      : "border-[#d4c8b8] bg-white/74 text-[#635d53] hover:border-[#cfbce9] hover:text-[#2f3138]"
                  }`}
                >
                  {filter}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filteredCharacters.map((char) => {
              const meta = CHARACTER_UI_META[char.id]
              return (
                <button
                  key={char.id}
                  onClick={() => setSelectedCharacterId(char.id)}
                  className="group overflow-hidden rounded-2xl border border-white/45 bg-[#f3ece1]/84 text-left shadow-[0_18px_30px_-22px_rgba(26,25,23,0.72)] transition duration-300 hover:-translate-y-1.5 hover:border-[#d7c2f2] hover:shadow-[0_24px_38px_-22px_rgba(26,25,23,0.84)]"
                >
                  <div className="relative aspect-[4/4.2] overflow-hidden">
                    <img
                      src={char.images.normal}
                      alt={char.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-transparent" />
                    {meta.badge && (
                      <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold tracking-[0.14em] text-white">
                        {meta.badge}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 p-3">
                    <h4 className="text-lg font-bold leading-tight text-[#282a33]">{char.name}</h4>
                    <p className="line-clamp-2 text-sm leading-relaxed text-[#4d473f]">{meta.summary}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {meta.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="rounded-md border border-[#dacfbf] bg-white/75 px-2 py-1 text-[11px] font-medium text-[#6b6459]">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="inline-flex items-center gap-1 text-xs font-semibold text-[#6b5a95]">
                      상세 보기
                      <ArrowRight className="h-3.5 w-3.5" />
                    </p>
                  </div>
                </button>
              )
            })}
          </div>

          {filteredCharacters.length === 0 && (
            <div className="py-20 text-center text-[#7f7b74]">검색 결과가 없습니다.</div>
          )}
        </section>
      </main>

      <footer className="relative z-10 px-4 pb-6 text-center text-xs text-[#7f776c]">
        © 2026 V-MATE. All rights reserved.
      </footer>

      {selectedCharacter && selectedCharacterMeta && (
        <CharacterDetailSheet
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelectedCharacterId(null)
            }
          }}
          character={selectedCharacter}
          meta={selectedCharacterMeta}
          onStartChat={() => onCharacterSelect(selectedCharacter)}
        />
      )}
    </div>
  )
}
