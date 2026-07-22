import { useEffect, useMemo, useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { ChevronRight, MessageSquareMore } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { platformApi } from '@/lib/platform/apiClient'
import type { HomeFeedPayload, RoomSummary } from '@/lib/platform/types'
import { EmptyState, EntityCard, FilterChip, PlatformShell } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

type HomeProps = PlatformPageChromeProps & {
  user: SupabaseUser | null
}

export function Home(props: HomeProps) {
  const {
    user,
    userAvatarInitial,
    searchQuery,
    onSearchChange,
    onNavigate,
    onAuthRequest,
    onSignOut,
    onDeleteAccount,
    selectedCharacter,
    selectedWorld,
    isStartingCombination,
    onSelectEntity,
    onClearSelectedEntity,
    onStartCombination,
  } = props
  const [characterFilter, setCharacterFilter] = useState<'new' | 'popular' | ''>('popular')
  const [worldFilter, setWorldFilter] = useState<'new' | 'popular' | ''>('new')
  const [homePayload, setHomePayload] = useState<HomeFeedPayload | null>(null)
  const [recentRooms, setRecentRooms] = useState<RoomSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    let mounted = true
    setIsLoading(true)
    setLoadError('')
    const loadHome = () => {
      void platformApi.fetchHome('characters', searchQuery, '')
        .then((home) => {
          if (!mounted) return
          setHomePayload(home)
        })
        .catch(() => { if (mounted) setLoadError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.') })
        .finally(() => { if (mounted) setIsLoading(false) })
    }
    const timer = searchQuery ? window.setTimeout(loadHome, 200) : undefined
    if (!searchQuery) loadHome()
    return () => {
      mounted = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [searchQuery, reloadVersion])

  useEffect(() => {
    let mounted = true
    if (!user) {
      setRecentRooms([])
      return () => { mounted = false }
    }

    void platformApi.fetchRecentRooms()
      .then((recent) => { if (mounted) setRecentRooms(recent.items.slice(0, 3)) })
      .catch(() => { if (mounted) setRecentRooms([]) })
    return () => { mounted = false }
  }, [user])

  const characters = useMemo(
    () => sortCatalog(homePayload?.home.characterFeed.items || [], characterFilter),
    [characterFilter, homePayload],
  )
  const worlds = useMemo(
    () => sortCatalog(homePayload?.home.worldFeed.items || [], worldFilter),
    [homePayload, worldFilter],
  )
  return (
    <PlatformShell
      user={user}
      userAvatarInitial={userAvatarInitial}
      searchValue={searchQuery}
      onSearchChange={onSearchChange}
      onNavigate={onNavigate}
      onAuthRequest={onAuthRequest}
      onSignOut={onSignOut}
      onDeleteAccount={onDeleteAccount}
      selectedCharacter={selectedCharacter}
      selectedWorld={selectedWorld}
      isStartingCombination={isStartingCombination}
      onClearSelectedEntity={onClearSelectedEntity}
      onStartCombination={onStartCombination}
    >
      <div className="mx-auto max-w-[1080px] space-y-12">
        <section className="border-b border-[#e7e7e7] pb-7 pt-1" aria-labelledby="catalog-title">
          <h1 id="catalog-title" className="text-[clamp(1.75rem,3.5vw,2.7rem)] font-black tracking-[-0.055em] text-[#171717]">대화할 캐릭터를 고르세요.</h1>
          <p className="mt-3 text-sm text-[#707070]">월드는 선택하지 않아도 됩니다.</p>
        </section>

        {loadError ? <EmptyState title="콘텐츠를 불러오지 못했습니다" description={loadError} action={<Button onClick={() => setReloadVersion((value) => value + 1)}>다시 불러오기</Button>} /> : <>
        <section aria-labelledby="character-title" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="character-title" className="text-xl font-black tracking-[-0.04em] text-[#171717]">캐릭터</h2>
            <div className="flex gap-1.5"><FilterChip active={characterFilter === 'popular'} onClick={() => setCharacterFilter('popular')}>인기순</FilterChip><FilterChip active={characterFilter === 'new'} onClick={() => setCharacterFilter('new')}>신작</FilterChip></div>
          </div>
          {isLoading ? <CardSkeletons type="character" count={2} /> : characters.length === 0 ? <EmptyState title={searchQuery ? '검색 결과가 없습니다' : '공개된 캐릭터가 없습니다'} description={searchQuery ? '다른 이름이나 태그로 검색해 보세요.' : '직접 캐릭터를 만들 수 있습니다.'} action={!searchQuery ? <Button onClick={() => user ? onNavigate('/create/character') : onAuthRequest()} className="bg-[#d43a34] shadow-none hover:bg-[#c9342f]">캐릭터 만들기</Button> : null} /> : (
            <div data-catalog-grid="characters" className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5">{characters.map((item, index) => <EntityCard key={item.id} item={item} priority={index === 0} selected={selectedCharacter?.id === item.id} onClick={() => onNavigate(`/characters/${item.slug}`)} onSelect={() => onSelectEntity(item)} />)}</div>
          )}
        </section>

        <section aria-labelledby="world-title" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="world-title" className="text-xl font-black tracking-[-0.04em] text-[#171717]">월드</h2><div className="flex gap-1.5"><FilterChip active={worldFilter === 'new'} onClick={() => setWorldFilter('new')}>신작</FilterChip><FilterChip active={worldFilter === 'popular'} onClick={() => setWorldFilter('popular')}>인기순</FilterChip></div></div>
          {isLoading ? <CardSkeletons type="world" count={2} /> : worlds.length === 0 ? <EmptyState title={searchQuery ? '검색 결과가 없습니다' : '공개된 월드가 없습니다'} description={searchQuery ? '다른 이름이나 태그로 검색해 보세요.' : '직접 월드를 만들 수 있습니다.'} action={!searchQuery ? <Button onClick={() => user ? onNavigate('/create/world') : onAuthRequest()} className="bg-[#d43a34] shadow-none hover:bg-[#c9342f]">월드 만들기</Button> : null} /> : (
            <div data-catalog-grid="worlds" className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5">{worlds.map((item, index) => <EntityCard key={item.id} item={item} priority={index === 0} selected={selectedWorld?.id === item.id} onClick={() => onNavigate(`/worlds/${item.slug}`)} onSelect={() => onSelectEntity(item)} />)}</div>
          )}
        </section>
        </>}

        {user ? (
          <section aria-labelledby="recent-title" className="space-y-4">
            <div className="flex items-center justify-between"><h2 id="recent-title" className="text-xl font-black tracking-[-0.04em] text-[#171717]">이어서 대화하기</h2>{recentRooms.length ? <button type="button" onClick={() => onNavigate('/recent')} className="flex items-center text-xs font-bold text-[#ff5148]">전체 보기<ChevronRight className="size-4" /></button> : null}</div>
            {recentRooms.length === 0 ? <EmptyState title="아직 시작한 대화가 없습니다" description="캐릭터를 선택해 대화를 시작하세요." /> : <div className="grid gap-3 lg:grid-cols-3">{recentRooms.map((room) => <button key={room.id} type="button" onClick={() => onNavigate(`/rooms/${room.id}`)} className="flex items-center gap-3 rounded-xl border border-[#e7e7e7] bg-white p-3 text-left transition hover:border-[#c6c6c6]"><img src={room.character.avatarImageUrl || room.character.coverImageUrl} alt="" decoding="async" className="size-12 rounded-lg object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[#171717]">{room.character.name}{room.world ? ` × ${room.world.name}` : ''}</p><p className="mt-1 truncate text-xs text-[#777777]">{room.state.currentSituation}</p></div><MessageSquareMore className="size-4 text-[#ff5148]" /></button>)}</div>}
          </section>
        ) : null}
      </div>
    </PlatformShell>
  )
}

function CardSkeletons({ type, count }: { type: 'character' | 'world'; count: number }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5">{Array.from({ length: count }).map((_, index) => <div key={index} className="animate-pulse overflow-hidden bg-white"><div className={cn(type === 'character' ? 'aspect-[4/5]' : 'aspect-[16/9]', 'rounded-lg bg-[#eeeeee]')} /><div className="space-y-2 pt-3"><div className="h-4 w-2/3 rounded bg-[#eeeeee]" /><div className="h-3 rounded bg-[#f3f3f3]" /></div></div>)}</div>
}

function cn(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ')
}

function sortCatalog<T extends { chatStartCount: number; favoriteCount: number; updatedAt: string }>(items: T[], filter: 'new' | 'popular' | '') {
  if (!filter) return items
  return [...items].sort((a, b) => {
    const recentOrder = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (filter === 'new') return recentOrder
    return b.chatStartCount - a.chatStartCount || b.favoriteCount - a.favoriteCount || recentOrder
  })
}
