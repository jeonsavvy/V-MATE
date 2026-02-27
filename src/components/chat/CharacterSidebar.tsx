import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { SidebarCharacterEntry } from "@/lib/chat/sidebarEntries"

interface CharacterSidebarProps {
  entries: SidebarCharacterEntry[]
  activeCharacterId: string
  onCharacterChange: (charId: string) => void
}

export function CharacterSidebar({
  entries,
  activeCharacterId,
  onCharacterChange,
}: CharacterSidebarProps) {
  return (
    <aside className="hidden h-full border-r border-white/45 bg-[#eee7db]/72 p-4 backdrop-blur-xl lg:block">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-2">
          <p className="text-sm font-bold text-[#2f3138]">캐릭터 목록</p>
          <p className="text-xs text-[#8e867a]">{entries.filter((entry) => entry.hasHistory).length}개 기록</p>
        </div>

        <div className="mt-4 space-y-2 overflow-y-auto pr-1">
          {entries.map((entry) => {
            const item = entry.character
            const isActive = item.id === activeCharacterId

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onCharacterChange(item.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "w-full rounded-2xl border p-3 text-left shadow-[0_14px_24px_-20px_rgba(23,22,20,0.72)] transition",
                  isActive
                    ? "border-[#d4c2ed] bg-white/94"
                    : "border-white/45 bg-white/74 hover:border-[#d1bfe9]"
                )}
              >
                <div className="flex items-start gap-3">
                  <Avatar
                    src={item.images.normal}
                    alt={item.name}
                    fallback={item.name[0]}
                    className="size-10 border border-black/10 object-cover object-top"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="truncate text-sm font-bold text-[#2f3138]">{item.name}</p>
                      <span className="rounded-full border border-[#d8cebf] bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-[#7b7469]">
                        {entry.hasHistory ? "최근" : "새 대화"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[#6b655b]">{entry.previewText}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
