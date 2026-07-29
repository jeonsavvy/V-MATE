import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function UnsavedChangesDialog({
  open,
  description,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  description: string
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}>
      <DialogContent className="max-w-lg rounded-xl bg-white text-[#171717]">
        <DialogHeader>
          <DialogTitle className="text-[#171717]">저장하지 않은 변경사항이 있습니다</DialogTitle>
          <DialogDescription className="text-[#737373]">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>계속 편집</Button>
          <Button className="bg-[#d43a34] text-white hover:bg-[#c9342f]" onClick={onConfirm} disabled={confirmDisabled}>저장하지 않고 이동</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
