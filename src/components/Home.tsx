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
          {characterItems.length === 0 ? (
            <EmptyState title="캐릭터가 없습니다" description="검색어나 필터를 바꿔 다시 확인해보세요." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {characterItems.map((item) => (
                <EntityCard
                  key={`${item.entityType}-${item.id}`}
                  item={item}
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
          {worldItems.length === 0 ? (
            <EmptyState title="월드가 없습니다" description="검색어나 필터를 바꿔 다시 확인해보세요." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {worldItems.map((item) => (
                <EntityCard
                  key={`${item.entityType}-${item.id}`}
                  item={item}
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
