import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { BookMarked, Home, Menu, MessageSquareMore, PlusCircle, Search, Shield, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { maskEmailAddress } from '@/lib/privacy'
import type { EntitySummary } from '@/lib/platform/types'

interface PlatformShellProps {
  user: SupabaseUser | null
  userAvatarInitial: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  onNavigate: (path: string) => void
  onAuthRequest: () => void
  onSignOut: () => void
  children: ReactNode
}

const baseNav = [
  { label: '홈', path: '/', icon: Home },
  { label: '최근 대화', path: '/recent', icon: MessageSquareMore },
  { label: '내 보관함', path: '/library', icon: BookMarked },
] as const

const createNav = [
  { label: '캐릭터', path: '/create/character' },
  { label: '월드', path: '/create/world' },
] as const

function PlatformNavPanel({
  user,
  userAvatarInitial,
  maskedEmail,
  createItems,
  onNavigate,
  onAuthRequest,
  onSignOut,
}: {
  user: SupabaseUser | null
  userAvatarInitial: string
  maskedEmail: string
  createItems: ReadonlyArray<{ label: string; path: string }>
  onNavigate: (path: string) => void
  onAuthRequest: () => void
  onSignOut: () => void
}) {
  return (
    <div className="flex h-full flex-col px-4 py-5">
      <button type="button" onClick={() => onNavigate('/')} className="flex items-center gap-3 text-left">
        <div className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">V-MATE</p>
        </div>
      </button>

      <nav className="mt-8 space-y-2">
        {baseNav.map(({ label, path, icon: Icon }) => (
          <button
            key={path}
            type="button"
            onClick={() => onNavigate(path)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-white/78 transition hover:bg-white/6 hover:text-white"
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-8 border-t border-white/8 pt-6">
        <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">만들기</p>
        <div className="space-y-2">
          {createItems.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-white/78 transition hover:bg-white/6 hover:text-white"
            >
              {item.path === '/ops' ? <Shield className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto border-t border-white/8 pt-6">
        {user ? (
          <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <Avatar fallback={userAvatarInitial} className="size-11 rounded-full bg-white/10 text-white" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{user.user_metadata?.name || '사용자'}</p>
                <p className="truncate text-xs text-white/52">{maskedEmail || '이메일 비공개'}</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={onSignOut} className="mt-3 w-full justify-center bg-white/5 text-white hover:bg-white/10">
              로그아웃
            </Button>
          </div>
        ) : (
          <Button onClick={onAuthRequest} className="w-full justify-center bg-white text-[#111317] hover:bg-white/92">로그인</Button>
        )}
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
  children,
}: PlatformShellProps) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const maskedEmail = user ? maskEmailAddress(user.email) : ''
  const createItems = useMemo(() => (
    user ? [...createNav, { label: '운영실', path: '/ops' }] : createNav
  ), [user])
  const handleNavigate = (path: string) => {
    setIsMobileNavOpen(false)
    onNavigate(path)
  }

  return (
    <div className="min-h-dvh bg-[#15171b] text-white">
      <a href="#platform-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-[#111317]">
        본문으로 건너뛰기
      </a>

      <Dialog open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <DialogContent className="left-0 top-0 h-dvh w-[min(22rem,calc(100vw-1rem))] max-w-none -translate-x-0 -translate-y-0 overflow-hidden rounded-none rounded-r-[2rem] border-l-0 border-t-0 border-b-0 border-white/10 bg-[#111317] p-0 text-white lg:hidden [&>button]:right-4 [&>button]:top-4 [&>button]:border-white/10 [&>button]:bg-white/5 [&>button]:text-white/72 [&>button]:hover:bg-white/10 [&>button]:hover:text-white">
          <DialogHeader className="sr-only">
            <DialogTitle>메뉴</DialogTitle>
            <DialogDescription>탐색 및 계정 메뉴</DialogDescription>
          </DialogHeader>
          <div className="h-full overflow-y-auto overscroll-contain pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <PlatformNavPanel
              user={user}
              userAvatarInitial={userAvatarInitial}
              maskedEmail={maskedEmail}
              createItems={createItems}
              onNavigate={handleNavigate}
              onAuthRequest={() => {
                setIsMobileNavOpen(false)
                onAuthRequest()
              }}
              onSignOut={async () => {
                setIsMobileNavOpen(false)
                await onSignOut()
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden border-r border-white/10 bg-[#111317] lg:flex lg:min-h-dvh lg:flex-col lg:overflow-y-auto">
          <PlatformNavPanel
            user={user}
            userAvatarInitial={userAvatarInitial}
            maskedEmail={maskedEmail}
            createItems={createItems}
            onNavigate={handleNavigate}
            onAuthRequest={onAuthRequest}
            onSignOut={onSignOut}
          />
        </aside>

        <div className="min-w-0 bg-[#181b20]">
          <header className="sticky top-0 z-30 border-b border-white/8 bg-[#181b20]/94 backdrop-blur">
            <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6 lg:px-8 lg:py-4">
              <div className="flex items-center justify-between gap-3 lg:hidden">
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsMobileNavOpen((prev) => !prev)}
                    aria-label={isMobileNavOpen ? '메뉴 닫기' : '메뉴 열기'}
                    className="shrink-0 rounded-full bg-white/5 text-white hover:bg-white/10 hover:text-white"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                  <button type="button" onClick={() => handleNavigate('/')} className="min-w-0 text-left">
                    <p className="truncate text-lg font-semibold text-white">V-MATE</p>
                  </button>
                </div>
              </div>

              <label className="relative block w-full max-w-full lg:max-w-[28rem]" htmlFor="platform-search">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <Input
                  id="platform-search"
                  value={searchValue}
                  onChange={(event) => onSearchChange?.(event.target.value)}
                  placeholder="캐릭터, 월드를 검색해보세요"
                  className="h-12 rounded-full border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/35"
                />
              </label>
            </div>
          </header>

          <main id="platform-main" className="min-w-0">
            <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
              {children}
            </div>
          </main>
          <footer className="text-center text-sm text-white/42">
            <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">© V-MATE</div>
          </footer>
        </div>
      </div>
    </div>
  )
}

export function PageSection({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4 rounded-[1.75rem] border border-white/10 bg-[#20242b] p-4 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.8)] sm:p-5 lg:p-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 sm:items-center">
        <h2 className="text-[clamp(1.45rem,3vw,1.9rem)] font-semibold tracking-[-0.03em] text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ArtworkFrame({
  src,
  alt,
  aspectClassName,
  imageClassName,
  priority = false,
  className,
}: {
  src?: string
  alt: string
  aspectClassName: string
  imageClassName?: string
  priority?: boolean
  className?: string
}) {
  return (
    <div className={cn(`relative w-full overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#111317] ${aspectClassName}`, className)}>
      {src ? (
        <>
          <img
            src={src}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-45"
            loading="lazy"
            decoding="async"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_60%)]" />
          <img
            src={src}
            alt={alt}
            className={cn('relative z-[1] h-full w-full object-contain p-3', imageClassName)}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-white/38">이미지 없음</div>
      )}
    </div>
  )
}

export function FilterChip({ active = false, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full px-3.5 py-2 text-sm font-semibold transition sm:px-4', active ? 'bg-[#d92c63] text-white' : 'bg-white/8 text-white/72 hover:bg-white/12 hover:text-white')}>
      {children}
    </button>
  )
}

const resolveEntityArtwork = (item: EntitySummary) => {
  if (item.coverImageUrl) {
    return item.coverImageUrl
  }

  const imageSlots = 'imageSlots' in item && Array.isArray(item.imageSlots) ? item.imageSlots : []
  const slot = imageSlots.find((entry) => entry.detailUrl || entry.cardUrl || entry.thumbUrl)
  return slot?.detailUrl || slot?.cardUrl || slot?.thumbUrl || ''
}

export function EntityCard({ item, meta, onClick, cta = '상세 보기', priority = false }: { item: EntitySummary; meta?: string; onClick?: () => void; cta?: string; priority?: boolean }) {
  void meta
  const mediaAspectClassName = item.entityType === 'world' ? 'aspect-[16/9]' : 'aspect-[3/4]'
  const artwork = resolveEntityArtwork(item)
  return (
    <button type="button" onClick={onClick} className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/8 bg-[#17191d] text-left transition hover:-translate-y-1 hover:border-white/16">
      <div className="relative">
        <ArtworkFrame src={artwork} alt={item.name} aspectClassName={mediaAspectClassName} imageClassName="transition duration-500 group-hover:scale-[1.01]" priority={priority} />
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-white">{item.sourceType === 'original' ? '오리지널' : '2차창작'}</span>
          {item.displayStatus === 'hidden' ? <span className="rounded-full bg-[#d92c63] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">숨김</span> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col space-y-4 p-4">
        <p className="line-clamp-2 break-words text-[1.2rem] font-semibold tracking-[-0.03em] text-white sm:text-[1.3rem]">{item.name}</p>
        <p className="line-clamp-2 text-sm leading-6 text-white/72">{item.summary}</p>
        <div className="flex flex-wrap gap-2">
          {item.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-full bg-white/7 px-2.5 py-1 text-[11px] text-white/62">{tag}</span>)}
        </div>
        <p className="mt-auto text-sm font-semibold text-white">{cta}</p>
      </div>
    </button>
  )
}

export function LinkCard({ title, body, onClick }: { title: string; body: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/18 hover:bg-white/7">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-white/66">{body}</p>
    </button>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-10 text-center sm:px-6 sm:py-12">
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-7 text-white/56">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
