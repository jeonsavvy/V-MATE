import { useEffect, useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { platformApi } from '@/lib/platform/apiClient'
import type { HomeFeedPayload } from '@/lib/platform/types'
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
  const [characterFilter, setCharacterFilter] = useState<'new' | 'popular' | ''>('')
  const [worldFilter, setWorldFilter] = useState<'new' | 'popular' | ''>('')
  const [homePayload, setHomePayload] = useState<HomeFeedPayload | null>(null)

  useEffect(() => {
    let mounted = true
    void Promise.all([
      platformApi.fetchCharacters(searchQuery, characterFilter),
      platformApi.fetchWorlds(searchQuery, worldFilter),
    ])
      .then(([characters, worlds]) => {
        if (!mounted) return
        setHomePayload({
          home: {
            defaultTab: 'characters',
            filterChips: ['신작', '인기'],
            hero: { title: '', subtitle: '', coverImageUrl: '', targetPath: '' },
            characterFeed: { items: characters.items },
            worldFeed: { items: worlds.items },
          },
        })
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '홈을 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [characterFilter, searchQuery, worldFilter])

  const characterItems = homePayload?.home.characterFeed.items || []
  const worldItems = homePayload?.home.worldFeed.items || []
  const isLoadingHome = homePayload === null

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
        <PageSection title="캐릭터 둘러보기" action={
          <div className="flex flex-wrap gap-2">
            <FilterChip active={characterFilter === 'new'} onClick={() => setCharacterFilter((prev) => prev === 'new' ? '' : 'new')}>신작</FilterChip>
            <FilterChip active={characterFilter === 'popular'} onClick={() => setCharacterFilter((prev) => prev === 'popular' ? '' : 'popular')}>인기</FilterChip>
          </div>
        }>
          {isLoadingHome ? (
            <EntityCardSkeletonGrid variant="character" count={4} />
          ) : characterItems.length === 0 ? (
            <EmptyState title="캐릭터가 없습니다" description="검색어나 필터를 바꿔 다시 확인해보세요." />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {characterItems.map((item, index) => (
                <EntityCard
                  key={`${item.entityType}-${item.id}`}
                  item={item}
                  priority={index === 0}
                  onClick={() => onNavigate(`/characters/${item.slug}`)}
                />
              ))}
            </div>
          )}
        </PageSection>

        <PageSection title="월드 둘러보기" action={
          <div className="flex flex-wrap gap-2">
            <FilterChip active={worldFilter === 'new'} onClick={() => setWorldFilter((prev) => prev === 'new' ? '' : 'new')}>신작</FilterChip>
            <FilterChip active={worldFilter === 'popular'} onClick={() => setWorldFilter((prev) => prev === 'popular' ? '' : 'popular')}>인기</FilterChip>
          </div>
        }>
          {isLoadingHome ? (
            <EntityCardSkeletonGrid variant="world" count={3} />
          ) : worldItems.length === 0 ? (
            <EmptyState title="월드가 없습니다" description="검색어나 필터를 바꿔 다시 확인해보세요." />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {worldItems.map((item, index) => (
                <EntityCard
                  key={`${item.entityType}-${item.id}`}
                  item={item}
                  priority={index === 0}
                  onClick={() => onNavigate(`/worlds/${item.slug}`)}
                />
              ))}
            </div>
          )}
        </PageSection>
      </div>
    </PlatformShell>
  )
}

function EntityCardSkeletonGrid({ variant, count }: { variant: 'character' | 'world'; count: number }) {
  return (
    <div className={variant === 'world' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'}>
      {Array.from({ length: count }).map((_, index) => (
        <EntityCardSkeleton key={`${variant}-skeleton-${index}`} variant={variant} />
      ))}
    </div>
  )
}

function EntityCardSkeleton({ variant }: { variant: 'character' | 'world' }) {
  const mediaAspectClassName = variant === 'world' ? 'aspect-[16/9]' : 'aspect-[3/4]'

  return (
    <div aria-hidden="true" className="flex h-full min-w-0 animate-pulse flex-col overflow-hidden rounded-[1.75rem] border border-white/8 bg-[#17191d]">
      <div className={`rounded-[1.6rem] border border-white/10 bg-white/[0.06] ${mediaAspectClassName}`} />
      <div className="flex flex-1 flex-col space-y-4 p-4">
        <div className="h-7 w-3/4 rounded-full bg-white/10" />
        <div className="space-y-2">
          <div className="h-4 rounded-full bg-white/8" />
          <div className="h-4 w-5/6 rounded-full bg-white/8" />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="h-6 w-14 rounded-full bg-white/7" />
          <div className="h-6 w-16 rounded-full bg-white/7" />
        </div>
        <div className="mt-auto h-5 w-20 rounded-full bg-white/10" />
      </div>
    </div>
  )
}
