import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Character } from "@/lib/data"

interface CharacterInfoDesktopProps {
  isOpen: boolean
  character: Character
  tags: string[]
  summary: string
  heroQuote?: string
  activeEmotionLabel: string
  showEmotionIllustrations: boolean
  onToggleIllustrations: () => void
}

export function CharacterInfoDesktop({
  isOpen,
  character,
  tags,
  summary,
  heroQuote,
  activeEmotionLabel,
  showEmotionIllustrations,
  onToggleIllustrations,
}: CharacterInfoDesktopProps) {
  if (!isOpen) {
    return null
  }

  return (
    <aside className="hidden h-full border-l border-white/45 bg-[#f0e9dd]/82 p-4 backdrop-blur-xl xl:block">
      <div className="flex h-full flex-col gap-4">
        <div className="overflow-hidden rounded-2xl border border-white/45 bg-white/76 shadow-[0_18px_32px_-24px_rgba(20,18,15,0.74)]">
          <img
            src={character.images.normal}
            alt={character.name}
            className="h-56 w-full object-cover object-top"
            loading="lazy"
            decoding="async"
          />
          <div className="space-y-2 p-4">
            <p className="text-lg font-bold text-[#2f3138]">{character.name}</p>
            <p className="text-sm leading-relaxed text-[#4f493f]">{summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="rounded-md border border-[#dacfbf] bg-white/80 px-2 py-1 text-[11px] font-medium text-[#6b6459]">
                  {tag}
                </span>
              ))}
            </div>
            {heroQuote && (
              <p className="rounded-xl border border-[#e1d6ea] bg-[#f7effc] px-3 py-2 text-xs font-semibold leading-relaxed text-[#6b4d88]">
                “{heroQuote}”
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/45 bg-white/72 p-4">
          <p className="text-sm font-bold text-[#2f3138]">대화 상태</p>
          <div className="rounded-xl border border-[#ddd1bf] bg-[#f7f1e6] px-3 py-2 text-xs text-[#5c564a]">
            현재 감정: <span className="font-semibold text-[#6a5991]">{activeEmotionLabel}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={onToggleIllustrations}
            aria-pressed={showEmotionIllustrations}
            className={cn(
              "h-10 w-full rounded-xl text-xs font-semibold",
              showEmotionIllustrations ? "text-[#5b5668] hover:bg-[#7d6aa8]/10" : "text-[#7a756d] hover:bg-black/5"
            )}
            title={showEmotionIllustrations ? "감정 일러스트 숨기기" : "감정 일러스트 보기"}
          >
            {showEmotionIllustrations ? "감정 일러스트 ON" : "감정 일러스트 OFF"}
          </Button>
        </div>
      </div>
    </aside>
  )
}
