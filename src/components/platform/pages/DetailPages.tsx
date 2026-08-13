import { useEffect, useRef, useState } from 'react'
import { BookMarked, Flag, Image, Loader2, MessageCircle, PlusCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { CharacterDetail, CharacterSummary, WorldDetail, WorldSummary } from '@/lib/platform/types'
import { platformApi } from '@/lib/platform/apiClient'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArtworkFrame, EmptyState, LinkCard, LoadingState, resolveEntityArtworkSources } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'
import { useKeyedResource } from '@/lib/useKeyedResource'
import { PageFrame, safeActionError } from '@/components/platform/shared/PageFrame'
const CharacterWorldPicker = ({
  open,
  onOpenChange,
  title,
  description,
  items,
  emptyOption,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  items: Array<{ id: string; title: string; body: string; value: string }>
  emptyOption?: { title: string; body: string }
  onSelect: (value: string | null) => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="grid max-h-[calc(100dvh-1.5rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-white text-[#171717]">
      <DialogHeader>
        <DialogTitle className="text-[#171717]">{title}</DialogTitle>
        <DialogDescription className="text-[#737373]">{description}</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain pr-1 md:grid-cols-2">
        {emptyOption ? <LinkCard title={emptyOption.title} body={emptyOption.body} onClick={() => onSelect(null)} /> : null}
        {items.map((item) => (
          <LinkCard key={item.id} title={item.title} body={item.body} onClick={() => onSelect(item.value)} />
        ))}
      </div>
    </DialogContent>
  </Dialog>
)

const ReportDialog = ({ open, onOpenChange, entityType, entityId, entityName }: { open: boolean; onOpenChange: (open: boolean) => void; entityType: 'character' | 'world'; entityId: string; entityName: string }) => {
  const [reason, setReason] = useState('other')
  const [details, setDetails] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submit = () => {
    setIsSubmitting(true)
    void platformApi.createReport({ entityType, entityId, reason, details })
      .then(() => { toast.success('신고를 접수했습니다.'); onOpenChange(false); setDetails('') })
      .catch((error) => toast.error(safeActionError(error, '신고를 접수하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.')))
      .finally(() => setIsSubmitting(false))
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-xl border-[#e7e7e7] bg-white sm:max-w-md"><DialogHeader><DialogTitle>{entityName} 신고</DialogTitle><DialogDescription>신고 사유를 선택해 주세요. 같은 콘텐츠는 한 번만 신고할 수 있습니다.</DialogDescription></DialogHeader><label className="space-y-2 text-sm font-semibold text-[#555]" htmlFor="report-reason"><span>신고 사유</span><select id="report-reason" name="report-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2"><option value="sexual_content">노골적인 성적 콘텐츠</option><option value="minor_safety">미성년자 안전</option><option value="hate_or_harassment">혐오·괴롭힘</option><option value="copyright">저작권·권리 침해</option><option value="spam">스팸·기만</option><option value="other">기타</option></select></label><label className="space-y-2 text-sm font-semibold text-[#555]" htmlFor="report-details"><span>상세 내용 <span className="font-normal text-[#666]">(선택)</span></span><textarea id="report-details" name="report-details" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="검토에 필요한 내용을 적어 주세요." className="min-h-28 w-full rounded-lg border border-[#d8d8d8] bg-white px-4 py-3 text-sm font-normal text-[#171717] placeholder:text-[#707070] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2" maxLength={1000} /></label><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button><Button onClick={submit} disabled={isSubmitting} className="bg-[#d43a34] text-white hover:bg-[#c9342f]">{isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Flag className="size-4" />}{isSubmitting ? '접수 중…' : '신고 접수'}</Button></DialogFooter></DialogContent></Dialog>
}

// 상세 화면은 공개 조회와 새 방 진입을 함께 책임진다.
export function CharacterDetailPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  const [item, setItem] = useState<CharacterDetail | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [availableWorlds, setAvailableWorlds] = useState<WorldSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isStartingRoom, setIsStartingRoom] = useState(false)
  const isStartingRoomRef = useRef(false)
  const [isBookmarked, setIsBookmarked] = useState<boolean | null>(false)
  const [reportOpen, setReportOpen] = useState(false)
  const resourceScope = `${slug}:${chrome.user?.id || 'anonymous'}:${chrome.authStatus}:${reloadVersion}`
  const characterResource = useKeyedResource(`character:${resourceScope}`, (signal) => platformApi.fetchCharacter(slug, { signal }))
  const worldsResource = useKeyedResource(`character-worlds:${resourceScope}`, (signal) => platformApi.fetchWorlds('', 'popular', { signal }))
  const loadError = characterResource.status === 'error' ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.' : ''
  const secondaryError = worldsResource.status === 'error' ? '월드 목록을 불러오지 못했습니다. 캐릭터 단독 대화는 시작할 수 있습니다.' : ''

  useEffect(() => {
    setItem(null)
  }, [resourceScope])

  useEffect(() => {
    if (characterResource.status !== 'success') return
    setItem(characterResource.data.item)
    setIsBookmarked(characterResource.data.viewer?.bookmarked === null ? null : Boolean(characterResource.data.viewer?.bookmarked))
  }, [characterResource])

  useEffect(() => {
    if (worldsResource.status === 'success') setAvailableWorlds(worldsResource.data.items)
  }, [worldsResource])

  useEffect(() => {
    if (!chrome.user || !item) {
      setIsBookmarked(false)
      return
    }

    void platformApi.addRecentView('character', item.slug).catch(() => undefined)
  }, [chrome.user, item])

  const startRoom = (worldSlug?: string | null) => {
    if (!item || isStartingRoomRef.current) return
    const userAlias = String(chrome.user?.user_metadata?.name || '').trim() || '나'
    isStartingRoomRef.current = true
    setIsStartingRoom(true)
    void platformApi.createRoom({ characterSlug: item.slug, worldSlug: worldSlug || null, userAlias })
      .then(({ room }) => chrome.onNavigate(`/rooms/${room.id}`))
      .catch((error) => toast.error(safeActionError(error, '새 대화를 시작하지 못했습니다. 현재 선택은 유지됩니다. 다시 시도해 주세요.')))
      .finally(() => { isStartingRoomRef.current = false; setIsStartingRoom(false) })
  }

  const handleStart = (selectedWorldSlug: string | null) => {
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }
    startRoom(selectedWorldSlug)
  }

  const handleBookmarkToggle = () => {
    if (!item) return
    if (isBookmarked === null) {
      setReloadVersion((value) => value + 1)
      return
    }
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }

    void platformApi.toggleBookmark('character', item.slug)
      .then(({ active }) => {
        setIsBookmarked(active)
        toast.success(active ? '즐겨찾기에 저장했습니다.' : '즐겨찾기를 해제했습니다.')
      })
      .catch((error) => toast.error(safeActionError(error, '즐겨찾기를 변경하지 못했습니다. 현재 상태는 유지됩니다. 다시 시도해 주세요.')))
  }

  const worldPickerItems = availableWorlds.map((world) => ({
    id: world.id,
    title: world.name,
    body: world.headline || world.summary,
    value: world.slug,
  }))

  if (!item) {
    return <PageFrame chrome={chrome} showCombinationDockOnMobile={false}>{loadError ? <EmptyState title="캐릭터를 불러오지 못했습니다" description={loadError} action={<Button onClick={() => setReloadVersion((value) => value + 1)}>다시 불러오기</Button>} /> : <LoadingState label="캐릭터 불러오는 중…" />}</PageFrame>
  }

  const characterArtwork = resolveEntityArtworkSources(item, 'detail')

  return (
    <PageFrame chrome={chrome} showCombinationDockOnMobile={false}>
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} entityType="character" entityId={item.id} entityName={item.name} />
      <CharacterWorldPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="월드 선택"
        description={secondaryError || "이 캐릭터와 대화할 월드를 선택합니다."}
        emptyOption={{ title: '월드 없이 시작', body: '캐릭터 단독 대화를 시작합니다.' }}
        items={worldPickerItems}
        onSelect={(worldSlug) => { setPickerOpen(false); handleStart(worldSlug) }}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)]">
        <ArtworkFrame src={characterArtwork.src} srcSet={characterArtwork.srcSet} sizes="(min-width: 1024px) 42vw, 100vw" alt={item.name} aspectClassName="aspect-[4/5] xl:max-h-[720px]" className="mx-auto w-full max-w-[28rem] rounded-lg lg:mx-0 lg:max-w-none" priority />
        <div className="space-y-6 py-1 lg:pl-4">
          <div className="border-b border-[#e7e7e7] pb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#666]">캐릭터</p>
            <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.6rem)] font-semibold tracking-[-0.04em] text-[#171717]">{item.name}</h1>
            <p className="mt-3 text-base leading-8 text-[#666666]">{item.summary}</p>
            <p className="mt-4 text-xs font-semibold text-[#666]">제작자 {item.creator.name} · {item.sourceType === 'original' ? '오리지널' : '2차창작'}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {item.imageSlots.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded bg-[#f3f3f3] px-3 py-1 text-xs text-[#565656]">
                <Image className="h-3.5 w-3.5" />
                이미지 {item.imageSlots.length}장
              </span>
            ) : null}
            {item.tags.map((tag) => <span key={tag} className="rounded bg-[#f3f3f3] px-3 py-1 text-xs text-[#565656]">{tag}</span>)}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => handleStart(null)} disabled={isStartingRoom} className="bg-[#d43a34] text-white hover:bg-[#c9342f]">{isStartingRoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}{isStartingRoom ? '대화 여는 중…' : '바로 대화'}</Button>
            <Button variant="outline" onClick={() => setPickerOpen(true)} disabled={isStartingRoom}>월드와 시작</Button>
            <Button variant="ghost" onClick={() => chrome.onSelectEntity(item)}><PlusCircle className="h-4 w-4" />{chrome.selectedCharacter?.id === item.id ? '조합에 담김' : '조합에 담기'}</Button>
            <Button variant="outline" onClick={handleBookmarkToggle}><BookMarked className="h-4 w-4" />{isBookmarked === null ? '즐겨찾기 다시 확인' : isBookmarked ? '즐겨찾기 해제' : '즐겨찾기 저장'}</Button>
            {chrome.user?.id === item.creator.id ? <Button variant="outline" onClick={() => chrome.onNavigate(`/edit/character/${item.slug}`)}>수정</Button> : null}
            {chrome.user?.id !== item.creator.id ? <Button variant="ghost" onClick={() => chrome.user ? setReportOpen(true) : chrome.onAuthRequest()}><Flag className="h-4 w-4" />신고</Button> : null}
          </div>

          <section className="border-t border-[#e7e7e7] pt-6" aria-labelledby="character-profile-title">
            <h2 id="character-profile-title" className="text-2xl font-bold tracking-[-0.04em] text-[#171717]">프로필</h2>
            <div className="mt-4 grid border-t border-[#e7e7e7] md:grid-cols-2">
              {item.profileSections.map((section) => <div key={section.title} className="border-b border-[#e7e7e7] py-4 md:pr-5 md:odd:border-r md:even:pl-5"><p className="text-sm font-bold text-[#171717]">{section.title}</p><p className="mt-2 text-sm leading-7 text-[#666]">{section.body}</p></div>)}
            </div>
          </section>
        </div>
      </div>
    </PageFrame>
  )
}

// 월드 상세는 월드 정보와 함께 진입 가능한 캐릭터 선택을 같은 맥락에서 제공한다.
export function WorldDetailPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  const [item, setItem] = useState<WorldDetail | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [availableCharacters, setAvailableCharacters] = useState<CharacterSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isStartingRoom, setIsStartingRoom] = useState(false)
  const isStartingRoomRef = useRef(false)
  const [isBookmarked, setIsBookmarked] = useState<boolean | null>(false)
  const [reportOpen, setReportOpen] = useState(false)
  const resourceScope = `${slug}:${chrome.user?.id || 'anonymous'}:${chrome.authStatus}:${reloadVersion}`
  const worldResource = useKeyedResource(`world:${resourceScope}`, (signal) => platformApi.fetchWorld(slug, { signal }))
  const charactersResource = useKeyedResource(`world-characters:${resourceScope}`, (signal) => platformApi.fetchCharacters('', 'popular', { signal }))
  const loadError = worldResource.status === 'error' ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.' : ''
  const secondaryError = charactersResource.status === 'error' ? '캐릭터 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : ''

  useEffect(() => {
    setItem(null)
  }, [resourceScope])

  useEffect(() => {
    if (worldResource.status !== 'success') return
    setItem(worldResource.data.item)
    setIsBookmarked(worldResource.data.viewer?.bookmarked === null ? null : Boolean(worldResource.data.viewer?.bookmarked))
  }, [worldResource])

  useEffect(() => {
    if (charactersResource.status === 'success') setAvailableCharacters(charactersResource.data.items)
  }, [charactersResource])

  useEffect(() => {
    if (!chrome.user || !item) {
      setIsBookmarked(false)
      return
    }

    void platformApi.addRecentView('world', item.slug).catch(() => undefined)
  }, [chrome.user, item])

  const startRoom = (character: CharacterSummary) => {
    if (!item || isStartingRoomRef.current) return
    const userAlias = String(chrome.user?.user_metadata?.name || '').trim() || '나'
    isStartingRoomRef.current = true
    setIsStartingRoom(true)
    void platformApi.createRoom({ characterSlug: character.slug, worldSlug: item.slug, userAlias })
      .then(({ room }) => chrome.onNavigate(`/rooms/${room.id}`))
      .catch((error) => toast.error(safeActionError(error, '새 대화를 시작하지 못했습니다. 현재 선택은 유지됩니다. 다시 시도해 주세요.')))
      .finally(() => { isStartingRoomRef.current = false; setIsStartingRoom(false) })
  }

  const handleStart = (character: CharacterSummary) => {
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }
    startRoom(character)
  }

  const handleBookmarkToggle = () => {
    if (!item) return
    if (isBookmarked === null) {
      setReloadVersion((value) => value + 1)
      return
    }
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }

    void platformApi.toggleBookmark('world', item.slug)
      .then(({ active }) => {
        setIsBookmarked(active)
        toast.success(active ? '즐겨찾기에 저장했습니다.' : '즐겨찾기를 해제했습니다.')
      })
      .catch((error) => toast.error(safeActionError(error, '즐겨찾기를 변경하지 못했습니다. 현재 상태는 유지됩니다. 다시 시도해 주세요.')))
  }

  if (!item) {
    return <PageFrame chrome={chrome} showCombinationDockOnMobile={false}>{loadError ? <EmptyState title="월드를 불러오지 못했습니다" description={loadError} action={<Button onClick={() => setReloadVersion((value) => value + 1)}>다시 불러오기</Button>} /> : <LoadingState label="월드 불러오는 중…" />}</PageFrame>
  }

  return (
    <PageFrame chrome={chrome} showCombinationDockOnMobile={false}>
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} entityType="world" entityId={item.id} entityName={item.name} />
      <CharacterWorldPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="캐릭터 선택"
        description={secondaryError || "이 월드에서 대화할 캐릭터를 선택합니다."}
        items={availableCharacters.map((character) => ({
          id: character.id,
          title: character.name,
          body: character.headline || character.summary,
          value: character.slug,
        }))}
        onSelect={(characterSlug) => {
          setPickerOpen(false)
          const selected = availableCharacters.find((character) => character.slug === characterSlug)
          if (selected) handleStart(selected)
        }}
      />
      <div className="mx-auto w-full max-w-[1000px] space-y-6">
        <ArtworkFrame {...resolveEntityArtworkSources(item, 'detail')} sizes="(min-width: 1024px) 1000px, 100vw" alt={item.name} aspectClassName="aspect-[16/9]" className="rounded-lg" priority />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
          <div className="space-y-6 py-1 lg:pr-6">
            <div className="border-b border-[#e7e7e7] pb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#666]">월드</p>
              <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.4rem)] font-semibold tracking-[-0.04em] text-[#171717]">{item.name}</h1>
              <p className="mt-3 text-base leading-8 text-[#666666]">{item.summary}</p>
              <p className="mt-4 text-xs font-semibold text-[#666]">제작자 {item.creator.name} · {item.sourceType === 'original' ? '오리지널' : '2차창작'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {item.imageSlots?.length ? (
                <span className="inline-flex items-center gap-1 rounded bg-[#f3f3f3] px-3 py-1 text-xs text-[#565656]">
                  <Image className="h-3.5 w-3.5" />
                  이미지 {item.imageSlots.length}장
                </span>
              ) : null}
              {item.tags.map((tag) => <span key={tag} className="rounded bg-[#f3f3f3] px-3 py-1 text-xs text-[#565656]">{tag}</span>)}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setPickerOpen(true)} disabled={isStartingRoom} className="bg-[#d43a34] text-white hover:bg-[#c9342f]">{isStartingRoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}{isStartingRoom ? '대화 여는 중…' : '캐릭터 선택'}</Button>
              <Button variant="ghost" onClick={() => chrome.onSelectEntity(item)}><PlusCircle className="h-4 w-4" />{chrome.selectedWorld?.id === item.id ? '조합에 담김' : '조합에 담기'}</Button>
              <Button variant="outline" onClick={handleBookmarkToggle}><BookMarked className="h-4 w-4" />{isBookmarked === null ? '즐겨찾기 다시 확인' : isBookmarked ? '즐겨찾기 해제' : '즐겨찾기 저장'}</Button>
              {chrome.user?.id === item.creator.id ? <Button variant="outline" onClick={() => chrome.onNavigate(`/edit/world/${item.slug}`)}>수정</Button> : null}
              {chrome.user?.id !== item.creator.id ? <Button variant="ghost" onClick={() => chrome.user ? setReportOpen(true) : chrome.onAuthRequest()}><Flag className="h-4 w-4" />신고</Button> : null}
            </div>
          </div>
          <section className="border-t border-[#e7e7e7] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1" aria-labelledby="world-information-title">
            <h2 id="world-information-title" className="text-2xl font-bold tracking-[-0.04em] text-[#171717]">월드 정보</h2>
            <div className="mt-4 border-t border-[#e7e7e7]">
              {item.worldSections.map((section) => <div key={section.title} className="border-b border-[#e7e7e7] py-4"><p className="text-sm font-bold text-[#171717]">{section.title}</p><p className="mt-2 text-sm leading-7 text-[#666]">{section.body}</p></div>)}
            </div>
          </section>
        </div>
      </div>
    </PageFrame>
  )
}
