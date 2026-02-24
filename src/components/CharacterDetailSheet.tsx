import { Character } from "@/lib/data"
import { CharacterUiMeta } from "@/lib/character-ui"
import { MessageCircle } from "lucide-react"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"

interface CharacterDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  character: Character
  meta: CharacterUiMeta
  onStartChat: () => void
}

export function CharacterDetailSheet({
  open,
  onOpenChange,
  character,
  meta,
  onStartChat,
}: CharacterDetailSheetProps) {
  const handleStartChat = () => {
    onOpenChange(false)
    onStartChat()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bottom-0 top-auto w-[calc(100%-12px)] max-w-[520px] translate-x-[-50%] translate-y-0 overflow-hidden rounded-t-[30px] border border-[#d8ccbe] bg-[#f6f0e7] p-0 gap-0 shadow-[0_30px_60px_-35px_rgba(22,20,18,0.8)] data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-2 sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] sm:rounded-3xl sm:data-[state=closed]:slide-out-to-top-[52%] sm:data-[state=open]:slide-in-from-top-[48%]">
        <DialogTitle className="sr-only">{character.name} 상세 정보</DialogTitle>
        <DialogDescription className="sr-only">{meta.summary}</DialogDescription>

        <div className="max-h-[86dvh] overflow-y-auto pb-28">
          <div className="relative aspect-[4/5] w-full overflow-hidden">
            <img src={character.images.normal} alt={character.name} className="h-full w-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/18 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 text-white">
              <div>
                {meta.badge && (
                  <span className="inline-flex rounded-full bg-[#8b6cc7] px-2 py-1 text-[10px] font-semibold tracking-[0.16em]">
                    {meta.badge}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <div className="space-y-1">
              <p className="text-lg font-bold text-[#252730]">{character.name}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {meta.tags.map((tag) => (
                <span key={tag} className="rounded-md border border-[#dbcfc1] bg-white/80 px-3 py-1 text-xs font-medium text-[#5e594f]">
                  {tag}
                </span>
              ))}
            </div>

            <p className="text-sm leading-relaxed text-[#4f4c44]">{meta.summary}</p>

            {meta.heroQuote && (
              <div className="rounded-2xl border border-[#e2d7ca] bg-white/75 p-4 text-sm font-semibold leading-relaxed text-[#3d3c38]">
                “{meta.heroQuote}”
              </div>
            )}
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-[#ddcfbf] bg-[#f6f0e7]/96 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl">
          <Button
            onClick={handleStartChat}
            className="h-11 w-full rounded-xl bg-gradient-to-r from-[#25262d] to-[#3a353f] text-white shadow-[0_14px_24px_-18px_rgba(19,18,16,0.9)] transition hover:brightness-110"
          >
            <MessageCircle className="h-4 w-4" />
            대화하기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
