import type { ReactNode } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toUserFacingError } from '@/lib/platform/apiClient'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, LoadingState, PlatformShell } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export const safeActionError = (error: unknown, fallback: string) => toUserFacingError(error, fallback).message

export const imageProcessingFailureMessage = () => '이미지를 처리하지 못했습니다. 기존 이미지는 유지됩니다. 파일을 다시 선택한 뒤 다시 시도해 주세요.'

export const PageFrame = ({ chrome, children, showCombinationDock = true, showCombinationDockOnMobile = true }: { chrome: PlatformPageChromeProps; children: ReactNode; showCombinationDock?: boolean; showCombinationDockOnMobile?: boolean }) => (
  <PlatformShell
    user={chrome.user}
    authStatus={chrome.authStatus}
    userAvatarInitial={chrome.userAvatarInitial}
    searchValue={chrome.searchQuery}
    onSearchChange={chrome.onSearchChange}
    onSearchSubmit={chrome.onSearchSubmit}
    onNavigate={chrome.onNavigate}
    onAuthRequest={chrome.onAuthRequest}
    onSignOut={chrome.onSignOut}
    onDeleteAccount={chrome.onDeleteAccount}
    selectedCharacter={chrome.selectedCharacter}
    selectedWorld={chrome.selectedWorld}
    isStartingCombination={chrome.isStartingCombination}
    onClearSelectedEntity={chrome.onClearSelectedEntity}
    onStartCombination={chrome.onStartCombination}
    showCombinationDock={showCombinationDock}
    showCombinationDockOnMobile={showCombinationDockOnMobile}
  >
    {children}
  </PlatformShell>
)

export const ProtectedGate = ({ chrome, title, description }: { chrome: PlatformPageChromeProps; title: string; description: string }) => (
  <PageFrame chrome={chrome} showCombinationDock={false}>
    {chrome.authStatus === 'checking' ? <LoadingState label="로그인 상태 확인 중…" /> : chrome.authStatus === 'unavailable' ? <EmptyState title="로그인 상태를 확인하지 못했습니다" description="인증을 다시 확인한 뒤 계속해 주세요." action={<Button onClick={chrome.onAuthRequest}>인증 다시 확인</Button>} /> : <EmptyState title={title} description={description} action={<Button onClick={chrome.onAuthRequest}>로그인</Button>} />}
  </PageFrame>
)

export const OwnedContentDeleteDialog = ({
  open,
  title,
  description,
  itemName,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  itemName: string
  isDeleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) => (
  <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !isDeleting) onCancel() }}>
    <DialogContent className="max-w-lg rounded-xl bg-white text-[#171717]">
      <DialogHeader>
        <DialogTitle className="text-[#171717]">{title}</DialogTitle>
        <DialogDescription className="text-[#737373]">{description}</DialogDescription>
      </DialogHeader>
      <div className="rounded-xl border border-[#ff5148]/30 bg-[#ff5148]/10 px-4 py-4 text-sm text-[#4d4d4d]">
        {itemName}
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={isDeleting}>취소</Button>
        <Button className="bg-[#d43a34] text-white hover:bg-[#c9342f]" onClick={onConfirm} disabled={isDeleting}>
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}삭제
        </Button>
      </div>
    </DialogContent>
  </Dialog>
)
