import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ClearChatDialogProps {
  open: boolean
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ClearChatDialog({
  open,
  isSubmitting,
  onOpenChange,
  onConfirm,
}: ClearChatDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-[#dfd3c1] bg-[#f8f2e9] p-5">
        <DialogHeader>
          <DialogTitle className="text-[#2f3138]">대화를 초기화할까요?</DialogTitle>
          <DialogDescription className="text-[#6f665a]">
            현재 캐릭터의 대화 기록이 삭제되며, 이 작업은 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="rounded-xl border border-[#d8ccbb] bg-white/70 text-[#5f584f] hover:bg-white"
          >
            취소
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isSubmitting}
            className="rounded-xl bg-red-600 text-white hover:bg-red-500"
          >
            {isSubmitting ? "초기화 중..." : "초기화"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
