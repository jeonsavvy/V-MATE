import type { ReactNode } from 'react'
import { useMemo } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { BookMarked, Home, MessageSquareMore, PlusCircle, Search, Shield, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
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
  const maskedEmail = user ? maskEmailAddress(user.email) : ''
  const createItems = useMemo(() => (
    user ? [...createNav, { label: '운영실', path: '/ops' }] : createNav
  ), [user])

  return (
    <div className="min-h-dvh bg-[#15171b] text-white">
      <div className="grid min-h-dvh grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-r border-white/10 bg-[#111317] px-4 py-5">
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
              <button key={path} type="button" onClick={() => onNavigate(path)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-white/78 transition hover:bg-white/6 hover:text-white">
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-8 border-t border-white/8 pt-6">
            <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">만들기</p>
            <div className="space-y-2">
              {createItems.map((item) => (
                <button key={item.path} type="button" onClick={() => onNavigate(item.path)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-white/78 transition hover:bg-white/6 hover:text-white">
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
        </aside>

        <div className="min-w-0 bg-[#181b20]">
          <header className="sticky top-0 z-30 border-b border-white/8 bg-[#181b20]/94 px-6 py-4 backdrop-blur">
            <label className="relative block max-w-[28rem]" htmlFor="platform-search">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <Input
                id="platform-search"
                value={searchValue}
                onChange={(event) => onSearchChange?.(event.target.value)}
                placeholder="캐릭터, 월드를 검색해보세요"
                className="h-12 rounded-full border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/35"
              />
            </label>
          </header>

          <main className="px-6 py-6">{children}</main>
          <footer className="border-t border-white/8 px-6 py-6 text-center text-sm text-white/42">© V-MATE</footer>
        </div>
      </div>
    </div>
  )
}

export function PageSection({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4 rounded-[2rem] border border-white/10 bg-[#20242b] p-5 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.8)]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function FilterChip({ active = false, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full px-4 py-2 text-sm font-semibold transition', active ? 'bg-[#d92c63] text-white' : 'bg-white/8 text-white/72 hover:bg-white/12 hover:text-white')}>
      {children}
    </button>
  )
}

export function EntityCard({ item, meta, onClick, cta = '상세 보기' }: { item: EntitySummary; meta?: string; onClick?: () => void; cta?: string }) {
  return (
    <button type="button" onClick={onClick} className="group overflow-hidden rounded-[1.75rem] border border-white/8 bg-[#17191d] text-left transition hover:-translate-y-1 hover:border-white/16">
      <div className="relative aspect-[3/4] overflow-hidden">
        <img src={item.coverImageUrl} alt={item.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" decoding="async" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_18%,rgba(0,0,0,0.82)_100%)]" />
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-white">{item.sourceType === 'original' ? '오리지널' : '2차창작'}</span>
          {item.displayStatus === 'hidden' ? <span className="rounded-full bg-[#d92c63] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">숨김</span> : null}
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <p className="text-[1.45rem] font-semibold tracking-[-0.03em]">{item.name}</p>
          {meta && <p className="mt-1 text-xs text-white/68">{meta}</p>}
        </div>
      </div>
      <div className="space-y-4 p-4">
        <p className="line-clamp-2 text-sm leading-6 text-white/72">{item.summary}</p>
        <div className="flex flex-wrap gap-2">
          {item.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-full bg-white/7 px-2.5 py-1 text-[11px] text-white/62">{tag}</span>)}
        </div>
        <div className="text-xs text-white/44">{item.creator.name}</div>
        <p className="text-sm font-semibold text-white">{cta}</p>
      </div>
    </button>
  )
}

export function LinkCard({ title, body, onClick }: { title: string; body: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/18 hover:bg-white/7">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-white/66">{body}</p>
    </button>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-7 text-white/56">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
