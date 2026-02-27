import { Button } from "@/components/ui/button"
import { ArrowLeft, PanelRightClose, PanelRightOpen, Trash2 } from "lucide-react"
import { CHARACTERS, type Character } from "@/lib/data"

interface ChatTopBarProps {
  character: Character
  characterTags: string[]
  isInfoPanelOpen: boolean
  onBack: () => void
  onToggleInfoPanel: () => void
  onClearChat: () => void
  onCharacterChange: (charId: string) => void
}

export function ChatTopBar({
  character,
  characterTags,
  isInfoPanelOpen,
  onBack,
  onToggleInfoPanel,
  onClearChat,
  onCharacterChange,
}: ChatTopBarProps) {
  return (
    <header className="flex items-center justify-between border-b border-white/55 bg-[#efe8dc]/90 p-3 shadow-[0_16px_26px_-24px_rgba(23,22,19,0.8)] backdrop-blur-xl lg:px-6 lg:py-4">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          onClick={onBack}
          className="h-10 rounded-xl text-[#666259] hover:bg-black/5 hover:text-[#2f3138]"
        >
          <ArrowLeft className="mr-1.5 h-5 w-5" />
          <span className="hidden sm:inline">홈으로</span>
        </Button>

        <div className="min-w-0">
          <p className="truncate text-base font-bold text-[#2f3138]">{character.name}</p>
          <p className="truncate text-xs text-[#6e675c]">{characterTags.join(" · ")}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onToggleInfoPanel}
          className="h-9 rounded-xl px-3 text-xs font-semibold text-[#5c5769] hover:bg-[#7d6aa8]/10"
          aria-expanded={isInfoPanelOpen}
          aria-label={isInfoPanelOpen ? "캐릭터 정보 패널 닫기" : "캐릭터 정보 패널 열기"}
        >
          {isInfoPanelOpen ? <PanelRightClose className="mr-1 h-4 w-4" /> : <PanelRightOpen className="mr-1 h-4 w-4" />}
          정보
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onClearChat}
          className="h-9 rounded-xl text-[#7a756d] hover:bg-red-500/10 hover:text-red-500"
          title="대화 초기화"
          aria-label="대화 초기화"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <select
          value={character.id}
          onChange={(e) => onCharacterChange(e.target.value)}
          aria-label="캐릭터 선택"
          className="cursor-pointer rounded-xl border border-[#c7bcac] bg-white/80 px-2.5 py-1.5 text-xs text-[#5f635f] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] outline-none transition hover:bg-white focus:border-[#8b6cc7] lg:hidden"
        >
          {Object.values(CHARACTERS).map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </div>
    </header>
  )
}
