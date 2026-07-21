import type { ReactNode } from 'react'
import { useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import {
  BookMarked,
  ChevronRight,
  Home,
  ImageOff,
  Loader2,
  MessageSquareMore,
  PlusCircle,
  Search,
  Shield,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { maskEmailAddress } from '@/lib/privacy'
import type { CharacterSummary, EntitySummary, WorldSummary } from '@/lib/platform/types'

interface PlatformShellProps {
  user: SupabaseUser | null
  userAvatarInitial: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  onNavigate: (path: string) => void
  onAuthRequest: () => void
  onSignOut: () => void
  onDeleteAccount: () => Promise<void>
  selectedCharacter?: CharacterSummary | null
  selectedWorld?: WorldSummary | null
  isStartingCombination?: boolean
  onClearSelectedEntity?: (entityType: 'character' | 'world') => void
  onStartCombination?: () => Promise<void>
  showCombinationDock?: boolean
  children: ReactNode
}

const navItems = [
  { label: '홈', path: '/', icon: Home },
  { label: '대화', path: '/recent', icon: MessageSquareMore },
  { label: '만들기', path: '/create/character', icon: PlusCircle },
  { label: '보관함', path: '/library', icon: BookMarked },
] as const

const currentPathname = () => typeof window === 'undefined' ? '/' : window.location.pathname

const isNavActive = (path: string) => {
  const pathname = currentPathname()
  if (path === '/') return pathname === '/'
  if (path === '/create/character') return pathname.startsWith('/create/') || pathname.startsWith('/edit/')
  return pathname.startsWith(path)
}

function AccountPanel({
  user,
  userAvatarInitial,
  onNavigate,
  onAuthRequest,
  onSignOut,
  onDeleteAccount,
}: Pick<PlatformShellProps, 'user' | 'userAvatarInitial' | 'onNavigate' | 'onAuthRequest' | 'onSignOut' | 'onDeleteAccount'>) {
  const [isOpen, setIsOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  if (!user) {
    return <Button onClick={onAuthRequest} variant="outline" className="h-10 w-full rounded-md border-[#dcdcdc] bg-white text-[#171717] shadow-none hover:border-[#ff5148] hover:bg-white hover:text-[#ff5148]">로그인</Button>
  }

  const submitDelete = async () => {
    if (confirmation !== '탈퇴' || isDeleting) return
    setIsDeleting(true)
    setDeleteError('')
    try {
      await onDeleteAccount()
      setIsDeleteOpen(false)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '계정 탈퇴 처리에 실패했습니다.')
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="relative">
        <button type="button" onClick={() => setIsOpen((value) => !value)} className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition hover:bg-[#f3f3f3]">
          <Avatar fallback={userAvatarInitial} className="size-9 rounded-full bg-[#eeeeee] text-[#3c3432]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#171717]">{user.user_metadata?.name || '사용자'}</p>
            <p className="truncate text-[11px] text-[#7a7a7a]">{maskEmailAddress(user.email) || '이메일 비공개'}</p>
          </div>
          <ChevronRight className={cn('size-4 text-[#909090] transition', isOpen && 'rotate-90')} />
        </button>
        {isOpen ? (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-full overflow-hidden rounded-lg border border-[#e7e7e7] bg-white p-1 shadow-[0_18px_55px_-28px_rgba(55,31,38,0.35)]">
            <button type="button" onClick={() => onNavigate('/ops')} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-[#4f4f4f] hover:bg-[#f5f5f5]"><Shield className="size-3.5" />운영실</button>
            <button type="button" onClick={onSignOut} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium text-[#4f4f4f] hover:bg-[#f5f5f5]">로그아웃</button>
            <button type="button" onClick={() => { setIsDeleteOpen(true); setConfirmation(''); setDeleteError('') }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium text-[#a42646] hover:bg-[#fff0f3]">계정 탈퇴</button>
          </div>
        ) : null}
      </div>
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="rounded-xl border-[#e7e7e7] bg-white sm:max-w-md">
          <DialogHeader><DialogTitle>계정 탈퇴</DialogTitle><DialogDescription>계정과 생성 콘텐츠, 대화 기록, 업로드 이미지를 삭제합니다. 계속하려면 `탈퇴`를 입력하세요.</DialogDescription></DialogHeader>
          <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="탈퇴" aria-label="계정 탈퇴 확인 문구" />
          {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting}>취소</Button>
            <Button variant="destructive" onClick={submitDelete} disabled={confirmation !== '탈퇴' || isDeleting}>{isDeleting ? '처리 중...' : '영구 탈퇴'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function BrandMark() {
  return (
    <div className="flex items-center">
      <span className="text-[1.15rem] font-black tracking-[-0.055em] text-[#171717]"><span className="text-[#ff5148]">V</span>-MATE</span>
    </div>
  )
}

function SelectionSlot({ item, type, onClear, onNavigate }: { item: EntitySummary | null; type: 'character' | 'world'; onClear?: () => void; onNavigate: (path: string) => void }) {
  const imageUrl = item ? resolveEntityArtwork(item) : ''
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md border border-[#e4e4e4] bg-[#fafafa] px-2.5 py-2 sm:max-w-[290px]">
      {item ? (
        <>
          <img src={imageUrl} alt="" decoding="async" className="size-10 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-[#8c8c8c]">{type === 'character' ? '캐릭터' : '월드 · 선택 사항'}</p>
            <p className="truncate text-sm font-bold text-[#171717]">{item.name}</p>
          </div>
          <button type="button" onClick={onClear} aria-label={`${item.name} 선택 해제`} className="rounded-md p-1 text-[#888888] transition hover:bg-[#f3f3f3] hover:text-[#171717]"><X className="size-4" /></button>
        </>
      ) : (
        <button type="button" onClick={() => onNavigate('/')} className="flex w-full items-center gap-2.5 text-left">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-[#cfcfcf] bg-white text-[#ff5148]">+</span>
          <span><span className="block text-[10px] font-semibold text-[#8c8c8c]">{type === 'character' ? '필수' : '선택 사항'}</span><span className="block text-sm font-bold text-[#4d4d4d]">{type === 'character' ? '캐릭터 선택' : '월드 선택'}</span></span>
        </button>
      )}
    </div>
  )
}

function CombinationDock({ character, world, isStarting, onClear, onStart, onNavigate }: {
  character: CharacterSummary | null
  world: WorldSummary | null
  isStarting: boolean
  onClear?: (entityType: 'character' | 'world') => void
  onStart?: () => Promise<void>
  onNavigate: (path: string) => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-[66px] z-40 border-t border-[#e2e2e2] bg-white/95 px-3 py-2 shadow-[0_-14px_36px_-30px_rgba(0,0,0,0.3)] backdrop-blur-sm lg:bottom-0 lg:left-[232px] lg:px-6">
      <div className="mx-auto grid max-w-[1440px] grid-cols-2 items-stretch gap-2 sm:flex">
        <SelectionSlot item={character} type="character" onClear={() => onClear?.('character')} onNavigate={onNavigate} />
        <SelectionSlot item={world} type="world" onClear={() => onClear?.('world')} onNavigate={onNavigate} />
        <Button onClick={() => void onStart?.()} disabled={isStarting} className="col-span-2 h-11 shrink-0 rounded-md bg-[#ff5148] px-5 font-bold text-white shadow-none hover:bg-[#e94740] sm:h-auto sm:min-h-14 sm:min-w-[210px]">
          {isStarting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {character ? '이 조합으로 시작' : '캐릭터를 선택하세요'}
          {!isStarting ? <ChevronRight className="ml-1 size-4" /> : null}
        </Button>
      </div>
    </div>
  )
}

export function PlatformShell({
  user,
  userAvatarInitial,
  searchValue = '',
  onSearchChange,
  onNavigate,
  onAuthRequest,
  onSignOut,
  onDeleteAccount,
  selectedCharacter = null,
  selectedWorld = null,
  isStartingCombination = false,
  onClearSelectedEntity,
  onStartCombination,
  showCombinationDock = true,
  children,
}: PlatformShellProps) {
  return (
    <div className="min-h-dvh bg-white text-[#171717]">
      <a href="#platform-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-[#ff5148] focus:px-4 focus:py-2 focus:text-white">본문으로 건너뛰기</a>

      <header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-[#e7e7e7] bg-white">
        <div className="flex h-full items-center gap-3 px-4 sm:px-5">
          <button type="button" onClick={() => onNavigate('/')} className="w-auto shrink-0 text-left lg:w-[212px]"><BrandMark /></button>
          <nav className="hidden h-full items-center gap-1 lg:flex" aria-label="주요 메뉴">
            {navItems.map(({ label, path }) => (
              <button key={path} type="button" onClick={() => onNavigate(path)} className={cn('relative h-full px-3 text-sm font-bold transition', isNavActive(path) ? 'text-[#171717] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[#ff5148]' : 'text-[#686868] hover:text-[#171717]')}>
                {label}
              </button>
            ))}
          </nav>
          <label className="relative ml-auto block w-full max-w-[420px]" htmlFor="platform-search">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#888]" />
            <Input id="platform-search" aria-label="캐릭터와 월드 검색" value={searchValue} onChange={(event) => onSearchChange?.(event.target.value)} placeholder="캐릭터, 월드 검색" className="h-10 rounded-md border-[#dedede] bg-white pl-10 text-sm shadow-none placeholder:text-[#aaa]" />
          </label>
          <button type="button" aria-label={user ? '보관함 열기' : '로그인'} onClick={user ? () => onNavigate('/library') : onAuthRequest} className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#dedede] bg-white text-[#555] transition hover:border-[#bdbdbd] hover:text-[#171717]"><UserRound className="size-5" /></button>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-[232px] border-r border-[#e7e7e7] bg-[#fafafa] lg:flex lg:flex-col">
        <div className="px-4 pb-3 pt-5">
          <p className="px-2 text-[11px] font-bold tracking-[-0.01em] text-[#777]">대화 기록</p>
          <div className="mt-3 space-y-1">
            <button type="button" onClick={() => onNavigate('/recent')} className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold transition', isNavActive('/recent') ? 'bg-white text-[#171717] shadow-[inset_0_0_0_1px_#e5e5e5]' : 'text-[#5f5f5f] hover:bg-white hover:text-[#171717]')}><MessageSquareMore className="size-4" />최근 대화</button>
            <button type="button" onClick={() => onNavigate('/library')} className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold transition', isNavActive('/library') ? 'bg-white text-[#171717] shadow-[inset_0_0_0_1px_#e5e5e5]' : 'text-[#5f5f5f] hover:bg-white hover:text-[#171717]')}><BookMarked className="size-4" />보관함</button>
          </div>
        </div>
        <div className="mx-4 border-t border-[#e5e5e5] px-2 py-4">
          <p className="text-xs font-semibold text-[#555]">새 대화</p>
          <p className="mt-1 text-[11px] leading-5 text-[#888]">캐릭터와 선택적 월드를 고르면 이곳에 대화가 쌓입니다.</p>
        </div>
        <div className="mt-auto border-t border-[#e5e5e5] p-3"><AccountPanel user={user} userAvatarInitial={userAvatarInitial} onNavigate={onNavigate} onAuthRequest={onAuthRequest} onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} /></div>
      </aside>

      <div className="min-h-dvh pt-16 lg:pl-[232px]">

        <main id="platform-main" className={cn('mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 sm:py-8 lg:px-10', showCombinationDock ? 'pb-44 sm:pb-36 lg:pb-28' : 'pb-24 lg:pb-10')}>
          {children}
        </main>
        <footer className={cn('border-t border-[#e9e9e9] px-4 py-7 text-center text-xs text-[#808080]', showCombinationDock && 'mb-[150px] lg:mb-[86px]')}>
          <span>© V-MATE</span><span className="mx-2">·</span><button type="button" onClick={() => onNavigate('/privacy')} className="underline-offset-4 hover:underline">개인정보처리방침</button>
        </footer>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid h-[66px] grid-cols-4 border-t border-[#dedede] bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {navItems.map(({ label, path, icon: Icon }) => (
          <button key={path} type="button" onClick={() => onNavigate(path)} className={cn('flex flex-col items-center justify-center gap-1 text-[10px] font-semibold', isNavActive(path) ? 'text-[#ff5148]' : 'text-[#6b6b6b]')}><Icon className="size-[19px]" />{label}</button>
        ))}
      </nav>
      {showCombinationDock ? <CombinationDock character={selectedCharacter} world={selectedWorld} isStarting={isStartingCombination} onClear={onClearSelectedEntity} onStart={onStartCombination} onNavigate={onNavigate} /> : null}
    </div>
  )
}

export function PageSection({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4 rounded-lg border border-[#e7e7e7] bg-white p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[clamp(1.25rem,2.4vw,1.6rem)] font-bold tracking-[-0.035em] text-[#171717]">{title}</h2>{action}</div>
      {children}
    </section>
  )
}

export function ArtworkFrame({ src, alt, aspectClassName, imageClassName, priority = false, className }: { src?: string; alt: string; aspectClassName: string; imageClassName?: string; priority?: boolean; className?: string }) {
  return (
    <div className={cn(`relative w-full overflow-hidden bg-[#eeeeee] ${aspectClassName}`, className)}>
      {src ? <img src={src} alt={alt} className={cn('h-full w-full object-cover', imageClassName)} loading={priority ? 'eager' : 'lazy'} decoding="async" /> : <div className="flex h-full items-center justify-center text-[#a79d97]"><ImageOff className="size-7" aria-label="이미지 없음" /></div>}
    </div>
  )
}

export function FilterChip({ active = false, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', active ? 'border-[#ff5148] bg-[#ff5148] text-white' : 'border-[#dedede] bg-white text-[#666] hover:border-[#bdbdbd] hover:text-[#171717]')}>{children}</button>
}

export const resolveEntityArtwork = (item: EntitySummary) => {
  if (item.entityType === 'character' && item.avatarImageUrl) return item.avatarImageUrl
  if (item.coverImageUrl) return item.coverImageUrl
  const imageSlots = 'imageSlots' in item && Array.isArray(item.imageSlots) ? item.imageSlots : []
  const slot = imageSlots.find((entry) => entry.detailUrl || entry.cardUrl || entry.thumbUrl)
  return slot?.detailUrl || slot?.cardUrl || slot?.thumbUrl || ''
}

export function EntityCard({ item, meta, onClick, onSelect, cta = '상세 보기', priority = false, selected = false }: { item: EntitySummary; meta?: string; onClick?: () => void; onSelect?: () => void; cta?: string; priority?: boolean; selected?: boolean }) {
  const artwork = resolveEntityArtwork(item)
  return (
    <article className="group flex h-full min-w-0 flex-col bg-white">
      <button type="button" onClick={onClick} className={cn('relative block w-full overflow-hidden rounded-lg bg-[#f1f1f1] text-left ring-offset-2 transition', selected && 'ring-2 ring-[#ff5148]')}>
        <ArtworkFrame src={artwork} alt={item.name} aspectClassName={item.entityType === 'world' ? 'aspect-[16/9]' : 'aspect-[4/5]'} imageClassName="transition duration-500 group-hover:scale-[1.02]" priority={priority} />
        <span className="absolute left-2.5 top-2.5 rounded bg-black/68 px-2 py-1 text-[10px] font-bold text-white backdrop-blur-sm">{item.entityType === 'character' ? '캐릭터' : '월드'}</span>
      </button>
      <div className="flex flex-1 flex-col pt-3">
        <button type="button" onClick={onClick} className="text-left"><h3 className="line-clamp-1 text-[1.02rem] font-bold tracking-[-0.025em] text-[#171717]">{item.name}</h3><p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-[#666]">{item.headline || item.summary}</p></button>
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">{item.tags.slice(0, 3).map((tag) => <span key={tag} className="text-[11px] font-medium text-[#888]">#{tag}</span>)}</div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3"><span className="truncate text-[11px] text-[#999]">{meta || `by ${item.creator.name}`}</span>{onSelect ? <Button size="sm" variant={selected ? 'default' : 'outline'} onClick={onSelect} className={cn('h-8 rounded-md px-3 text-xs shadow-none', selected ? 'bg-[#ff5148] hover:bg-[#e94740]' : 'border-[#d8d8d8] bg-white hover:border-[#ff5148] hover:bg-white hover:text-[#ff5148]')}>{selected ? '선택됨' : '선택'}</Button> : <span className="text-xs font-bold text-[#ff5148]">{cta}</span>}</div>
      </div>
    </article>
  )
}

export function LinkCard({ title, body, onClick }: { title: string; body: string; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="min-w-0 rounded-lg border border-[#e7e7e7] bg-[#ffffff] p-4 text-left transition hover:border-[#c6c6c6] hover:bg-white"><p className="text-sm font-bold text-[#171717]">{title}</p><p className="mt-2 text-sm leading-6 text-[#666666]">{body}</p></button>
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-[#d8d8d8] bg-[#ffffff] px-5 py-10 text-center"><p className="text-base font-bold text-[#171717]">{title}</p><p className="mt-2 text-sm leading-6 text-[#786e69]">{description}</p>{action ? <div className="mt-4">{action}</div> : null}</div>
}
