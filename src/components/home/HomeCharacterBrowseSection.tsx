import { CHARACTER_UI_META, type CharacterFilter } from "@/lib/character-ui"
import type { Character, CharacterId } from "@/lib/data"
import { ArrowRight } from "lucide-react"

interface HomeCharacterBrowseSectionProps {
  filteredCharacters: Character[]
  characterFilters: CharacterFilter[]
  activeFilter: CharacterFilter
  onFilterChange: (filter: CharacterFilter) => void
  onSelectCharacterDetail: (characterId: CharacterId) => void
}

export function HomeCharacterBrowseSection({
  filteredCharacters,
  characterFilters,
  activeFilter,
  onFilterChange,
  onSelectCharacterDetail,
}: HomeCharacterBrowseSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-[#8c8376]">BROWSE</p>
          <h3 className="mt-1 text-2xl font-black text-[#252730]">캐릭터 모아보기</h3>
        </div>
        <p className="text-xs font-semibold text-[#756d62]">총 {filteredCharacters.length}개</p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="캐릭터 필터">
        {characterFilters.map((filter) => {
          const isActive = activeFilter === filter
          return (
            <button
              key={filter}
              type="button"
              onClick={() => onFilterChange(filter)}
              aria-pressed={isActive}
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
        {filteredCharacters.map((character) => {
          const meta = CHARACTER_UI_META[character.id]
          return (
            <button
              key={character.id}
              type="button"
              onClick={() => onSelectCharacterDetail(character.id)}
              className="group overflow-hidden rounded-2xl border border-white/45 bg-[#f3ece1]/84 text-left shadow-[0_18px_30px_-22px_rgba(26,25,23,0.72)] transition duration-300 hover:-translate-y-1.5 hover:border-[#d7c2f2] hover:shadow-[0_24px_38px_-22px_rgba(26,25,23,0.84)]"
            >
              <div className="relative aspect-[4/4.2] overflow-hidden">
                <img
                  src={character.images.normal}
                  alt={character.name}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                  decoding="async"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-transparent" />
                {meta.badge && (
                  <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold tracking-[0.14em] text-white">
                    {meta.badge}
                  </span>
                )}
              </div>

              <div className="space-y-2 p-3">
                <h4 className="text-lg font-bold leading-tight text-[#282a33]">{character.name}</h4>
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
  )
}
