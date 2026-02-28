import { CHARACTER_UI_META } from "@/lib/character-ui"
import type { Character, CharacterId } from "@/lib/data"
import { ArrowRight, Flame } from "lucide-react"

interface HomeCuratedPicksSectionProps {
  heroCharacters: Character[]
  heroSignals: string[]
  onSelectCharacterDetail: (characterId: CharacterId) => void
}

export function HomeCuratedPicksSection({
  heroCharacters,
  heroSignals,
  onSelectCharacterDetail,
}: HomeCuratedPicksSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-[#8c8376]">CURATED PICKS</p>
          <h2 className="mt-1 text-2xl font-black text-[#252730] sm:text-[2rem]">추천 캐릭터</h2>
          <p className="mt-1 text-sm text-[#645d53]">바로 대화하기 좋은 캐릭터를 먼저 보여드립니다.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/68 px-3 py-1.5 text-xs font-semibold text-[#5d574c]">
          <Flame className="h-3.5 w-3.5 text-[#7b5cb8]" />
          상세 확인 후 바로 시작
        </div>
      </div>

      {heroCharacters.length > 0 && (
        <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:overflow-visible md:px-0 md:pb-0 md:grid-cols-[1.45fr_1fr_1fr]">
          {heroCharacters.map((character, index) => {
            const meta = CHARACTER_UI_META[character.id]

            return (
              <button
                key={character.id}
                type="button"
                onClick={() => onSelectCharacterDetail(character.id)}
                className="group relative min-h-[300px] w-[82vw] shrink-0 snap-center overflow-hidden rounded-3xl border border-white/45 text-left shadow-[0_22px_42px_-24px_rgba(22,20,18,0.82)] transition hover:-translate-y-1.5 hover:shadow-[0_30px_48px_-24px_rgba(22,20,18,0.9)] sm:w-[56vw] md:w-auto md:min-h-[340px]"
              >
                <img
                  src={character.images.normal}
                  alt={character.name}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  style={{ objectPosition: meta.heroObjectPosition || "center top" }}
                  loading="lazy"
                  decoding="async"
                />
                <div className="absolute inset-0 bg-[linear-gradient(112deg,rgba(11,10,14,0.82)_10%,rgba(11,10,14,0.5)_44%,rgba(11,10,14,0.22)_72%,rgba(11,10,14,0.08)_100%),linear-gradient(to_top,rgba(6,6,8,0.9)_0%,rgba(6,6,8,0.56)_46%,rgba(6,6,8,0.08)_82%)]" />
                <div className="absolute inset-x-0 bottom-0 space-y-2 p-5 text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.82)]">
                  <p className="inline-flex w-fit rounded-full bg-black/36 px-2 py-1 text-[11px] font-semibold tracking-[0.14em] text-white/92">
                    {heroSignals[index] ?? "추천 캐릭터"}
                  </p>
                  <h3 className="text-[1.7rem] font-black leading-tight">{character.name}</h3>
                  <p className="line-clamp-2 text-sm text-white/92">{meta.heroQuote ?? meta.summary}</p>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-white/94">
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
  )
}
