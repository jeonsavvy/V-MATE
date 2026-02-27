import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Character } from "@/lib/data"

interface CharacterInfoMobileProps {
  isOpen: boolean
  character: Character
  tags: string[]
  summary: string
  activeEmotionLabel: string
  showEmotionIllustrations: boolean
  onToggleIllustrations: () => void
}

export function CharacterInfoMobile({
  isOpen,
  character,
  tags,
  summary,
  activeEmotionLabel,
  showEmotionIllustrations,
  onToggleIllustrations,
}: CharacterInfoMobileProps) {
  if (!isOpen) {
    return null
  }

  return (
    <section className="border-b border-white/45 bg-[#f2ebdf]/92 px-3 py-3 xl:hidden">
      <div className="mx-auto w-full max-w-[980px] space-y-3 rounded-2xl border border-white/45 bg-white/72 p-3">
        <div className="flex items-center gap-3">
          <img
            src={character.images.normal}
            alt={character.name}
            className="h-16 w-16 rounded-xl object-cover object-top"
            loading="lazy"
            decoding="async"
          />
          <div>
            <p className="text-sm font-bold text-[#2f3138]">{character.name}</p>
            <p className="text-xs text-[#6d665b]">{tags.join(" · ")}</p>
            <p className="mt-1 text-xs font-semibold text-[#7a638f]">{activeEmotionLabel}</p>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-[#4f493f]">{summary}</p>
        <Button
          type="button"
          variant="ghost"
          onClick={onToggleIllustrations}
          aria-pressed={showEmotionIllustrations}
          className={cn(
            "h-9 w-full rounded-xl text-xs font-semibold",
            showEmotionIllustrations ? "text-[#5b5668] hover:bg-[#7d6aa8]/10" : "text-[#7a756d] hover:bg-black/5"
          )}
        >
          {showEmotionIllustrations ? "감정 일러스트 ON" : "감정 일러스트 OFF"}
        </Button>
      </div>
    </section>
  )
}
