import { useEffect, useMemo, useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { platformApi } from '@/lib/platform/apiClient'
import type { CharacterSummary, HomeFeedPayload, WorldSummary } from '@/lib/platform/types'
import { EmptyState, EntityCard, FilterChip, PageSection, PlatformShell } from '@/components/platform/PlatformScaffold'

interface HomeProps {
  user: SupabaseUser | null
  userAvatarInitial: string
  searchQuery: string
  onSearchChange: (value: string) => void
  onNavigate: (path: string) => void
  onAuthRequest: () => void
  onSignOut: () => void
}

export function Home({ user, userAvatarInitial, searchQuery, onSearchChange, onNavigate, onAuthRequest, onSignOut }: HomeProps) {
  void user
  void onAuthRequest
  const [tab, setTab] = useState<'characters' | 'worlds'>('characters')
  const [filter, setFilter] = useState<'new' | 'tag' | ''>('')
  const [homePayload, setHomePayload] = useState<HomeFeedPayload | null>(null)

  useEffect(() => {
    let mounted = true
    void platformApi.fetchHome(tab, searchQuery)
      .then((data) => { if (mounted) setHomePayload(data) })
      .catch((error) => toast.error(error instanceof Error ? error.message : '홈을 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [tab, searchQuery])

  const items = useMemo(() => {
    if (!homePayload) return [] as Array<CharacterSummary | WorldSummary>
    const source = tab === 'characters' ? homePayload.home.characterFeed.items : homePayload.home.worldFeed.items
    if (filter === 'new') {
      return [...source].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    }
    return source
  }, [filter, homePayload, tab])

  const hero = homePayload?.home.hero

  return (
    <PlatformShell
      user={user}
      userAvatarInitial={userAvatarInitial}
      searchValue={searchQuery}
      onSearchChange={onSearchChange}
      onNavigate={onNavigate}
      onAuthRequest={onAuthRequest}
      onSignOut={onSignOut}
    >
      <div className="space-y-6" data-footer-copy="© V-MATE">
        <button type="button" onClick={() => onNavigate(hero?.targetPath || '/')} className="group grid w-full gap-0 overflow-hidden rounded-[2rem] border border-white/10 bg-[#0f1115] lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col justify-center p-6 text-left lg:p-7">
            <div>
              <h1 className="text-[clamp(2rem,4vw,3.1rem)] font-semibold leading-[1.08] tracking-[-0.04em] text-white">{hero?.title || '미소노 미카'}</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-white/64">{hero?.subtitle || '친밀한 반말과 밝은 장난기가 중심인 인기 RP 캐릭터.'}</p>
            </div>
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white">
              상세 보기
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </div>
          <div className="min-h-[220px] bg-[#0d1322] lg:min-h-[260px]">
            <img src={hero?.coverImageUrl || '/world_sao.svg'} alt={hero?.title || '대표 배너'} className="h-full w-full object-cover object-top" loading="eager" decoding="async" />
          </div>
        </button>

        <PageSection title="둘러보기" action={
          <div className="flex flex-wrap gap-2">
            <FilterChip active={tab === 'characters'} onClick={() => setTab('characters')}>캐릭터</FilterChip>
            <FilterChip active={tab === 'worlds'} onClick={() => setTab('worlds')}>월드</FilterChip>
          </div>
        }>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={filter === 'new'} onClick={() => setFilter((prev) => prev === 'new' ? '' : 'new')}>신작</FilterChip>
            <FilterChip active={filter === 'tag'} onClick={() => setFilter((prev) => prev === 'tag' ? '' : 'tag')}>태그</FilterChip>
          </div>
          {items.length === 0 ? (
            <EmptyState title="콘텐츠가 없습니다" description="검색어나 필터를 바꿔 다시 확인해보세요." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {items.map((item) => (
                <EntityCard
                  key={`${item.entityType}-${item.id}`}
                  item={item}
                  meta={item.creator.name}
                  onClick={() => onNavigate(item.entityType === 'character' ? `/characters/${item.slug}` : `/worlds/${item.slug}`)}
                />
              ))}
            </div>
          )}
        </PageSection>
      </div>
    </PlatformShell>
  )
}
