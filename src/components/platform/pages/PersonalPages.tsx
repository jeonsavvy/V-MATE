import { useEffect, useState } from 'react'
import type { LibraryPayload, RoomSummary } from '@/lib/platform/types'
import { platformApi } from '@/lib/platform/apiClient'
import { Button } from '@/components/ui/button'
import { EmptyState, EntityCard, LoadingState, NavigationLink, PageSection } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'
import { PageFrame, ProtectedGate } from '@/components/platform/shared/PageFrame'

export function RecentRoomsPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [items, setItems] = useState<RoomSummary[]>([])
  const [isLoading, setIsLoading] = useState(Boolean(chrome.user))
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    if (!chrome.user) return
    let mounted = true
    setIsLoading(true)
    setLoadError('')
    void platformApi.fetchRecentRooms({ limit: 20, includeMessages: false })
      .then(({ items }) => { if (mounted) setItems(items) })
      .catch(() => { if (mounted) setLoadError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.') })
      .finally(() => { if (mounted) setIsLoading(false) })
    return () => { mounted = false }
  }, [chrome.user, reloadVersion])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인이 필요합니다" description="로그인하면 최근 대화를 확인할 수 있습니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      <PageSection title="최근 대화">
        {isLoading ? <LoadingState /> : loadError ? <EmptyState title="최근 대화를 불러오지 못했습니다" description={loadError} action={<Button onClick={() => setReloadVersion((value) => value + 1)}>다시 불러오기</Button>} /> : items.length === 0 ? (
          <EmptyState title="아직 최근 대화가 없습니다" description="캐릭터를 선택해 대화를 시작하세요." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((room) => (
              <NavigationLink key={room.id} path={`/rooms/${room.id}`} onNavigate={chrome.onNavigate} className="block w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4 text-left transition hover:border-[#c6c6c6] hover:bg-[#fafafa]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${room.world ? 'bg-[#eef5ff] text-[#335a82]' : 'bg-[#f4f1f8] text-[#624c78]'}`}>{room.world ? '월드 포함' : '캐릭터 대화'}</span>
                  <span className="text-xs text-[#666]">{room.character.name}{room.world ? ` · ${room.world.name}` : ''}</span>
                </div>
                <p className="mt-3 text-lg font-semibold text-[#171717]">{room.title}</p>
                <p className="mt-2 text-sm font-semibold text-[#171717]/70">마지막 장면</p>
                <p className="mt-1 text-sm leading-6 text-[#6f6f6f]">{room.state.currentSituation}</p>
              </NavigationLink>
            ))}
          </div>
        )}
      </PageSection>
    </PageFrame>
  )
}
export function LibraryPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [library, setLibrary] = useState<LibraryPayload | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    if (!chrome.user) return
    let mounted = true
    setLibrary(null)
    setLoadError('')
    void platformApi.fetchLibrary({ includeRecentRooms: false })
      .then((data) => { if (mounted) setLibrary(data) })
      .catch(() => { if (mounted) setLoadError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.') })
    return () => { mounted = false }
  }, [chrome.user, reloadVersion])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인이 필요합니다" description="로그인하면 즐겨찾기와 만든 콘텐츠를 확인할 수 있습니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      {!library ? (
        loadError ? <EmptyState title="보관함을 불러오지 못했습니다" description={loadError} action={<Button onClick={() => setReloadVersion((value) => value + 1)}>다시 불러오기</Button>} /> : <LoadingState label="보관함 불러오는 중…" />
      ) : (
        <div className="space-y-6">
          <PageSection title="즐겨찾기">
            {library.bookmarks.length === 0 ? <EmptyState title="아직 즐겨찾기가 없습니다" description="캐릭터나 월드 상세에서 즐겨찾기에 저장할 수 있습니다." /> : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {library.bookmarks.map((entry) => <EntityCard key={entry.id} item={entry.item} href={entry.entityType === 'character' ? `/characters/${entry.item.slug}` : `/worlds/${entry.item.slug}`} onNavigate={chrome.onNavigate} />)}
              </div>
            )}
          </PageSection>

          <PageSection title="최근 본 항목">
            {library.recentViews.length === 0 ? <EmptyState title="아직 최근 본 항목이 없습니다" description="확인한 캐릭터와 월드가 여기에 표시됩니다." /> : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {library.recentViews.map((entry) => <EntityCard key={entry.id} item={entry.item} href={entry.entityType === 'character' ? `/characters/${entry.item.slug}` : `/worlds/${entry.item.slug}`} onNavigate={chrome.onNavigate} />)}
              </div>
            )}
          </PageSection>

          <PageSection title="내가 만든 캐릭터">
            {library.owned.characters.length === 0 ? <EmptyState title="아직 만든 캐릭터가 없습니다" action={<Button onClick={() => chrome.onNavigate('/create/character')}>캐릭터 만들기</Button>} /> : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {library.owned.characters.map((item) => <EntityCard key={item.id} item={item} href={`/characters/${item.slug}`} onNavigate={chrome.onNavigate} />)}
              </div>
            )}
          </PageSection>

          <PageSection title="내가 만든 월드">
            {library.owned.worlds.length === 0 ? <EmptyState title="아직 만든 월드가 없습니다" action={<Button onClick={() => chrome.onNavigate('/create/world')}>월드 만들기</Button>} /> : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {library.owned.worlds.map((item) => <EntityCard key={item.id} item={item} href={`/worlds/${item.slug}`} onNavigate={chrome.onNavigate} />)}
              </div>
            )}
          </PageSection>
        </div>
      )}
    </PageFrame>
  )
}
