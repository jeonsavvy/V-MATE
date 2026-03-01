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
            긴 대화는 전송 시 자동으로 압축됩니다. 초기화를 누르면 이 캐릭터 대화 기록이 모두 삭제됩니다.
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
