import { Button } from "@/components/ui/button"
import type { Character, CharacterId } from "@/lib/data"
import { CHARACTERS } from "@/lib/data"
import type { RecentChatItem } from "@/lib/chat/historyRepository"
import { ArrowRight, Clock3, Sparkles } from "lucide-react"

interface HomeHeroSectionProps {
  primaryCharacter: Character
  primaryHeroQuote: string
  primaryObjectPosition?: string
  recentChatsCount: number
  recentContinuation: RecentChatItem[]
  onCharacterSelect: (character: Character) => void
  onSelectCharacterDetail: (characterId: CharacterId) => void
  formatRelativeTime: (updatedAt: string | null) => string
}

export function HomeHeroSection({
  primaryCharacter,
  primaryHeroQuote,
  primaryObjectPosition,
  recentChatsCount,
  recentContinuation,
  onCharacterSelect,
  onSelectCharacterDetail,
  formatRelativeTime,
}: HomeHeroSectionProps) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
      <div className="relative overflow-hidden rounded-[30px] border border-white/45 bg-black/40 shadow-[0_28px_54px_-32px_rgba(23,21,18,0.85)]">
        <img
          src={primaryCharacter.images.normal}
          alt={`${primaryCharacter.name} 대표 이미지`}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: primaryObjectPosition || "center top" }}
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(20,17,23,0.88)_12%,rgba(20,17,23,0.45)_56%,rgba(20,17,23,0.25)_100%)]" />
        <div className="absolute -right-16 top-8 h-44 w-44 rounded-full bg-[#9a80d6]/35 blur-[70px]" />

        <div className="relative flex min-h-[290px] flex-col justify-end gap-4 p-6 text-white sm:min-h-[360px] sm:p-8">
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-white/35 bg-white/12 px-3 py-1 text-xs font-semibold tracking-[0.12em] text-white/90">
            <Sparkles className="h-3.5 w-3.5" />
            QUICK START
          </span>
          <div className="space-y-2">
            <h1 className="max-w-2xl text-3xl font-black leading-tight text-white sm:text-4xl">
              원하는 톤으로 바로 대화해요
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-white/86 sm:text-base">
              {primaryHeroQuote}
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
              onClick={() => onSelectCharacterDetail(primaryCharacter.id)}
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
          <p className="text-xs font-semibold text-[#746d63]">{recentChatsCount}개 기록</p>
        </div>

        {recentContinuation.length > 0 ? (
          <div className="mt-4 space-y-2">
            {recentContinuation.map((item) => {
              const character = CHARACTERS[item.characterId]
              if (!character) {
                return null
              }

              return (
                <button
                  key={item.characterId}
                  type="button"
                  onClick={() => onCharacterSelect(character)}
                  className="group flex w-full items-center gap-3 rounded-2xl border border-[#ece2d6] bg-white/86 p-3 text-left transition hover:border-[#d7c6ee] hover:bg-white"
                >
                  <img
                    src={character.images.normal}
                    alt={character.name}
                    className="h-12 w-12 rounded-xl object-cover object-top"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-bold text-[#2f3138]">{character.name}</p>
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
            아직 저장된 대화가 없습니다. 캐릭터를 고르고 첫 메시지를 시작해보세요.
          </div>
        )}
      </div>
    </section>
  )
}
