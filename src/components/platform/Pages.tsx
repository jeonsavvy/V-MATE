import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookMarked, Eye, EyeOff, Flag, Image, ImagePlus, Loader2, MessageCircle, PlusCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CharacterDetail, CharacterSummary, ChatQuota, ContentReport, LibraryPayload, OwnerOpsDashboard, RoomSummary, WorldDetail, WorldSummary } from '@/lib/platform/types'
import { PlatformApiError, platformApi, toUserFacingError } from '@/lib/platform/apiClient'
import { CHARACTER_VARIANTS, createImageVariants, type ResizedImageAsset, WORLD_VARIANTS } from '@/lib/platform/imagePipeline'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ArtworkFrame, EmptyState, EntityCard, LinkCard, LoadingState, NavigationLink, PageSection, PlatformShell, resolveEntityArtworkSources } from '@/components/platform/PlatformScaffold'
import { ChatComposer } from '@/components/platform/ChatComposer'
import { UnsavedChangesDialog } from '@/components/platform/UnsavedChangesDialog'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

// 상세, 시작, 대화, 제작, 운영 화면을 한 파일에 두고 공통 흐름을 재사용한다.
const safeActionError = (error: unknown, fallback: string) => toUserFacingError(error, fallback).message
const imageProcessingFailureMessage = () => '이미지를 처리하지 못했습니다. 기존 이미지는 유지됩니다. 파일을 다시 선택한 뒤 다시 시도해 주세요.'

const PageFrame = ({ chrome, children, showCombinationDock = true, showCombinationDockOnMobile = true }: { chrome: PlatformPageChromeProps; children: ReactNode; showCombinationDock?: boolean; showCombinationDockOnMobile?: boolean }) => (
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

const ProtectedGate = ({ chrome, title, description }: { chrome: PlatformPageChromeProps; title: string; description: string }) => (
  <PageFrame chrome={chrome} showCombinationDock={false}>
    {chrome.authStatus === 'checking' ? <LoadingState label="로그인 상태 확인 중…" /> : chrome.authStatus === 'unavailable' ? <EmptyState title="로그인 상태를 확인하지 못했습니다" description="인증을 다시 확인한 뒤 계속해 주세요." action={<Button onClick={chrome.onAuthRequest}>인증 다시 확인</Button>} /> : <EmptyState title={title} description={description} action={<Button onClick={chrome.onAuthRequest}>로그인</Button>} />}
  </PageFrame>
)

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

const OwnedContentDeleteDialog = ({
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
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-xl border-[#e7e7e7] bg-white sm:max-w-md"><DialogHeader><DialogTitle>{entityName} 신고</DialogTitle><DialogDescription>신고 사유를 선택해 주세요. 같은 콘텐츠는 한 번만 신고할 수 있습니다.</DialogDescription></DialogHeader><label className="space-y-2 text-sm font-semibold text-[#555]" htmlFor="report-reason"><span>신고 사유</span><select id="report-reason" name="report-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2"><option value="sexual_content">노골적인 성적 콘텐츠</option><option value="minor_safety">미성년자 안전</option><option value="hate_or_harassment">혐오·괴롭힘</option><option value="copyright">저작권·권리 침해</option><option value="spam">스팸·기만</option><option value="other">기타</option></select></label><label className="space-y-2 text-sm font-semibold text-[#555]" htmlFor="report-details"><span>상세 내용 <span className="font-normal text-[#888]">(선택)</span></span><textarea id="report-details" name="report-details" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="검토에 필요한 내용을 적어 주세요." className="min-h-28 w-full rounded-lg border border-[#d8d8d8] bg-white px-4 py-3 text-sm font-normal text-[#171717] placeholder:text-[#707070] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2" maxLength={1000} /></label><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button><Button onClick={submit} disabled={isSubmitting} className="bg-[#d43a34] text-white hover:bg-[#c9342f]">{isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Flag className="size-4" />}{isSubmitting ? '접수 중…' : '신고 접수'}</Button></DialogFooter></DialogContent></Dialog>
}

// 상세 화면은 공개 조회와 새 방 진입을 함께 책임진다.
export function CharacterDetailPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  const [item, setItem] = useState<CharacterDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [availableWorlds, setAvailableWorlds] = useState<WorldSummary[]>([])
  const [secondaryError, setSecondaryError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isStartingRoom, setIsStartingRoom] = useState(false)
  const isStartingRoomRef = useRef(false)
  const [isBookmarked, setIsBookmarked] = useState<boolean | null>(false)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    setItem(null)
    setLoadError('')
    setSecondaryError('')
    void platformApi.fetchCharacter(slug)
      .then(({ item: character, viewer }) => {
        if (!mounted) return
        setItem(character)
        setIsBookmarked(viewer?.bookmarked === null ? null : Boolean(viewer?.bookmarked))
      })
      .catch(() => { if (mounted) setLoadError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.') })
    void platformApi.fetchWorlds('', 'popular')
      .then((worlds) => { if (mounted) setAvailableWorlds(worlds.items) })
      .catch(() => { if (mounted) setSecondaryError('월드 목록을 불러오지 못했습니다. 캐릭터 단독 대화는 시작할 수 있습니다.') })
    return () => { mounted = false }
  }, [slug, reloadVersion, chrome.user?.id, chrome.authStatus])

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
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8c8c8c]">캐릭터</p>
            <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.6rem)] font-semibold tracking-[-0.04em] text-[#171717]">{item.name}</h1>
            <p className="mt-3 text-base leading-8 text-[#666666]">{item.summary}</p>
            <p className="mt-4 text-xs font-semibold text-[#777]">제작자 {item.creator.name} · {item.sourceType === 'original' ? '오리지널' : '2차창작'}</p>
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
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [availableCharacters, setAvailableCharacters] = useState<CharacterSummary[]>([])
  const [secondaryError, setSecondaryError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isStartingRoom, setIsStartingRoom] = useState(false)
  const isStartingRoomRef = useRef(false)
  const [isBookmarked, setIsBookmarked] = useState<boolean | null>(false)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    setItem(null)
    setLoadError('')
    setSecondaryError('')
    void platformApi.fetchWorld(slug)
      .then(({ item: world, viewer }) => {
        if (!mounted) return
        setItem(world)
        setIsBookmarked(viewer?.bookmarked === null ? null : Boolean(viewer?.bookmarked))
      })
      .catch(() => { if (mounted) setLoadError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.') })
    void platformApi.fetchCharacters('', 'popular')
      .then((characters) => { if (mounted) setAvailableCharacters(characters.items) })
      .catch(() => { if (mounted) setSecondaryError('캐릭터 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') })
    return () => { mounted = false }
  }, [slug, reloadVersion, chrome.user?.id, chrome.authStatus])

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
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8c8c8c]">월드</p>
              <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.4rem)] font-semibold tracking-[-0.04em] text-[#171717]">{item.name}</h1>
              <p className="mt-3 text-base leading-8 text-[#666666]">{item.summary}</p>
              <p className="mt-4 text-xs font-semibold text-[#777]">제작자 {item.creator.name} · {item.sourceType === 'original' ? '오리지널' : '2차창작'}</p>
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

const NarrativeMessage = ({ message }: { message: RoomSummary['messages'][number] }) => {
  if (message.role === 'user') {
    return <div className="flex justify-end"><p className="max-w-[84%] whitespace-pre-wrap break-words rounded-[14px_14px_3px_14px] bg-[#f1f1f1] px-4 py-3 text-sm leading-7 text-[#171717]">{message.content as string}</p></div>
  }
  const payload = message.content as Extract<RoomSummary['messages'][number]['content'], object>
  return (
    <div className="space-y-3 border-b border-[#eeeeee] py-4 last:border-b-0">
      {payload.narration ? <p className="whitespace-pre-wrap break-words text-sm italic leading-7 text-[#777]">{payload.narration}</p> : null}
      <p className="whitespace-pre-wrap break-words text-base leading-8 text-[#171717]">{payload.response}</p>
      {payload.inner_heart ? <details className="rounded-md bg-[#f7f7f7] px-3 py-2 text-sm text-[#666]"><summary className="cursor-pointer font-semibold text-[#555]">속마음 보기</summary><p className="mt-2 whitespace-pre-wrap break-words leading-6">{payload.inner_heart}</p></details> : null}
    </div>
  )
}

const isViewportNearDocumentBottom = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true
  return document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) <= 160
}

// 시작 URL은 상세 화면으로 정규화해 링크 형태만 다르고 핵심 경험은 하나로 유지한다.
export function StartCharacterPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  useEffect(() => {
    chrome.onNavigate(`/characters/${slug}`)
  }, [chrome, slug])
  return <PageFrame chrome={chrome}><LoadingState label="캐릭터로 이동 중…" /></PageFrame>
}

export function StartWorldPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  useEffect(() => {
    chrome.onNavigate(`/worlds/${slug}`)
  }, [chrome, slug])
  return <PageFrame chrome={chrome}><LoadingState label="월드로 이동 중…" /></PageFrame>
}

// 플레이 룸은 메시지, 상태 요약, 이미지 슬롯 반영을 같은 세션 모델로 묶는다.
export function RoomPage({ chrome, roomId }: { chrome: PlatformPageChromeProps; roomId: string }) {
  const [room, setRoom] = useState<RoomSummary | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [needsRetry, setNeedsRetry] = useState(false)
  const [quota, setQuota] = useState<ChatQuota | null>(null)
  const [quotaError, setQuotaError] = useState('')
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null)
  const isSendingRef = useRef(false)
  const roomScopeEpochRef = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const hasPositionedInitialMessagesRef = useRef(false)
  const previousMessageCountRef = useRef(0)
  const shouldFollowMessagesRef = useRef(true)

  useEffect(() => {
    roomScopeEpochRef.current += 1
    isSendingRef.current = false
    setRoom(null)
    setInput('')
    setQuota(null)
    setPendingRequestId(null)
    setNeedsRetry(false)
    setIsLoading(false)
    setLoadError('')
    setQuotaError('')
    hasPositionedInitialMessagesRef.current = false
    previousMessageCountRef.current = 0
    shouldFollowMessagesRef.current = true
  }, [chrome.user?.id, roomId])

  useEffect(() => {
    const updateFollowState = () => {
      shouldFollowMessagesRef.current = isViewportNearDocumentBottom()
    }
    updateFollowState()
    window.addEventListener('scroll', updateFollowState, { passive: true })
    return () => window.removeEventListener('scroll', updateFollowState)
  }, [chrome.user?.id, roomId])

  useEffect(() => {
    if (!chrome.user) return
    let mounted = true
    const scopeEpoch = roomScopeEpochRef.current
    setLoadError('')
    setQuotaError('')
    void platformApi.fetchRoom(roomId)
      .then(({ room }) => { if (mounted && scopeEpoch === roomScopeEpochRef.current) setRoom(room) })
      .catch(() => { if (mounted && scopeEpoch === roomScopeEpochRef.current) setLoadError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.') })
    void platformApi.fetchChatQuota()
      .then(({ quota }) => { if (mounted && scopeEpoch === roomScopeEpochRef.current) setQuota(quota) })
      .catch(() => { if (mounted && scopeEpoch === roomScopeEpochRef.current) setQuotaError('사용량을 불러오지 못했습니다. 메시지를 보내면 서버에서 한도를 확인합니다.') })
    return () => { mounted = false }
  }, [chrome.user?.id, roomId, reloadVersion])

  useEffect(() => {
    if (!room) return
    const isInitialPosition = !hasPositionedInitialMessagesRef.current
    const hasNewMessages = room.messages.length > previousMessageCountRef.current
    const shouldScroll = isInitialPosition || (hasNewMessages && shouldFollowMessagesRef.current)
    hasPositionedInitialMessagesRef.current = true
    previousMessageCountRef.current = room.messages.length
    if (!shouldScroll) return

    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView?.({ block: 'end', behavior: isInitialPosition ? 'auto' : 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [room?.id, room?.messages.length])

  const activeCharacterImage = useMemo(() => {
    if (!room) return ''
    const latestAssistant = [...room.messages].reverse().find((message) => message.role === 'assistant' && typeof message.content === 'object')
    const content = latestAssistant && typeof latestAssistant.content === 'object' ? latestAssistant.content : null
    const explicitSlot = content?.character_image_slot?.trim()
    const emotion = content?.emotion || 'normal'
    const slots = room.character.imageSlots || []
    if (explicitSlot) {
      const matched = slots.find((slot) => slot.slot === explicitSlot)
      if (matched) {
        return matched.detailUrl || matched.cardUrl || room.character.coverImageUrl
      }
    }
    const selected =
      slots.find((slot) => slot.slot === emotion) ||
      slots.find((slot) => slot.slot === 'normal') ||
      slots.find((slot) => slot.slot === 'main')
    return selected?.detailUrl || room.character.avatarImageUrl || room.character.coverImageUrl
  }, [room])

  const activeWorldImage = useMemo(() => {
    if (!room?.world) return ''
    const latestAssistant = [...room.messages].reverse().find((message) => message.role === 'assistant' && typeof message.content === 'object')
    const explicitSlot = latestAssistant && typeof latestAssistant.content === 'object'
      ? latestAssistant.content.world_image_slot?.trim()
      : ''
    const slots = room.world.imageSlots || []
    if (explicitSlot) {
      const matched = slots.find((slot) => slot.slot === explicitSlot)
      if (matched) {
        return matched.detailUrl || matched.cardUrl || room.world.coverImageUrl
      }
    }
    return slots.find((slot) => slot.slot === 'main')?.detailUrl || room.world.coverImageUrl
  }, [room])

  const sendMessage = () => {
    const messageToSend = input.trim()
    if (!room || !messageToSend || isSendingRef.current || quota?.remaining === 0) return

    const requestId = pendingRequestId || crypto.randomUUID()
    const scopeEpoch = roomScopeEpochRef.current
    shouldFollowMessagesRef.current = isViewportNearDocumentBottom()
    isSendingRef.current = true
    setPendingRequestId(requestId)
    setNeedsRetry(false)
    setIsLoading(true)
    void platformApi.sendRoomMessage(room.id, messageToSend, requestId)
      .then((payload) => {
        if (scopeEpoch !== roomScopeEpochRef.current) return
        setRoom(payload.room)
        setQuota(payload.quota)
        setInput('')
        setPendingRequestId(null)
        setNeedsRetry(false)
      })
      .catch((error) => {
        if (scopeEpoch !== roomScopeEpochRef.current) return
        const typedError = error instanceof PlatformApiError ? error : null
        // 응답이 불확실한 실패 뒤에는 같은 ID로 재시도해 이미 반영된 turn을
        // replay한다. 현재 입력에 이 ID를 쓸 수 없다는 명시적 충돌만 폐기한다.
        if (typedError?.code === 'CLIENT_REQUEST_ID_CONFLICT') setPendingRequestId(null)
        if (typedError?.code === 'CHAT_REQUEST_IN_PROGRESS') {
          if (typedError.details?.quota) setQuota(typedError.details.quota)
          setNeedsRetry(true)
          toast.error('메시지를 처리 중입니다. 잠시 후 다시 보내 주세요.')
          return
        }
        if (typedError?.code === 'CHAT_DAILY_LIMIT_EXCEEDED') {
          if (typedError.details?.quota) setQuota(typedError.details.quota)
          toast.error('오늘 보낼 수 있는 메시지를 모두 사용했습니다.')
          return
        }
        setNeedsRetry(true)
        toast.error(safeActionError(error, '메시지를 보내지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.'))
      })
      .finally(() => {
        if (scopeEpoch !== roomScopeEpochRef.current) return
        isSendingRef.current = false
        setIsLoading(false)
      })
  }

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인이 필요합니다" description="로그인하면 대화를 이어서 저장할 수 있습니다." />
  }

  return (
    <PageFrame chrome={chrome} showCombinationDock={false}>
      {!room ? (
        loadError ? <EmptyState title="대화를 불러오지 못했습니다" description={loadError} action={<Button onClick={() => setReloadVersion((value) => value + 1)}>다시 불러오기</Button>} /> : <LoadingState label="대화 불러오는 중…" />
      ) : (
        <div className="mx-auto max-w-[960px] space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-[#e7e7e7] pb-5">
              <div>
                <h1 className="text-2xl font-bold tracking-[-0.04em] text-[#171717]">{room.title}</h1>
                <p className="mt-1 text-sm text-[#777]">{room.userAlias} · {room.character.name}{room.world ? ` · ${room.world.name}` : ''}</p>
              </div>
              <Button variant="ghost" className="shrink-0 text-[#666]" onClick={() => chrome.onNavigate(room.world ? `/worlds/${room.world.slug}` : `/characters/${room.character.slug}`)}>
                <ArrowLeft className="h-4 w-4" />{room.world ? '월드 보기' : '캐릭터 보기'}
              </Button>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="border-b border-[#e7e7e7] pb-4 lg:sticky lg:top-24 lg:rounded-lg lg:border lg:p-3" aria-label="대화 정보">
              <div className="hidden lg:block">
                <ArtworkFrame src={activeCharacterImage} alt={room.character.name} aspectClassName="aspect-[4/5]" className="rounded-md" priority />
              </div>
              <div className="flex items-start gap-3 lg:mt-3">
                <ArtworkFrame src={activeCharacterImage} alt="" aspectClassName="aspect-square" className="size-16 shrink-0 rounded-md lg:hidden" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#171717]">{room.character.name}</p>
                  {room.world ? <p className="mt-0.5 truncate text-xs text-[#777]">{room.world.name}</p> : null}
                  <p className="mt-1 text-xs leading-5 text-[#777]">{room.state.currentSituation}</p>
                </div>
              </div>
              {room.world && activeWorldImage ? (
                <div className="mt-3 hidden border-t border-[#eeeeee] pt-3 lg:block">
                  <p className="mb-2 text-[11px] font-semibold text-[#777]">월드 · {room.world.name}</p>
                  <ArtworkFrame src={activeWorldImage} alt={`${room.world.name} 월드 배경`} aspectClassName="aspect-[16/9]" className="rounded-md" />
                </div>
              ) : null}
            </aside>

            <div className="min-w-0">
              <section aria-label="대화 메시지" className="min-h-[240px] space-y-4 py-1">
                  {room.messages.map((message) => <NarrativeMessage key={message.id} message={message} />)}
                  {isLoading ? <div role="status" className="text-sm text-[#777]"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />응답 작성 중…</div> : null}
              </section>

              <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] z-20 bg-white pb-2 lg:bottom-0">
                {quotaError ? <p role="status" className="mb-2 text-xs text-[#777]">{quotaError} <button type="button" className="underline" onClick={() => { setQuotaError(''); void platformApi.fetchChatQuota().then(({ quota }) => setQuota(quota)).catch(() => setQuotaError('사용량을 다시 불러오지 못했습니다.')) }}>다시 시도</button></p> : null}
                <ChatComposer
                  value={input}
                  onChange={(value) => {
                    if (value !== input) {
                      setPendingRequestId(null)
                      if (needsRetry) setNeedsRetry(false)
                    }
                    setInput(value)
                  }}
                  onSubmit={sendMessage}
                  isSending={isLoading}
                  quota={quota}
                  needsRetry={needsRetry}
                />
              </div>
              <div ref={messagesEndRef} aria-hidden="true" className="h-px" />
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  )
}

const FileUploadCard = ({
  inputId,
  title,
  description,
  previewUrl,
  previewAlt,
  aspectClassName,
  hint,
  actionLabel = '이미지 선택',
  disabled = false,
  isProcessing = false,
  onChange,
}: {
  inputId: string
  title: string
  description: string
  previewUrl: string
  previewAlt: string
  aspectClassName: string
  hint: string
  actionLabel?: string
  disabled?: boolean
  isProcessing?: boolean
  onChange: (file: File) => void
}) => (
  <div className="grid gap-4 rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4 md:grid-cols-[220px_minmax(0,1fr)]">
    <ArtworkFrame src={previewUrl} alt={previewAlt} aspectClassName={aspectClassName} />

    <div className="flex flex-col justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-[#171717]">{title}</p>
        <p className="mt-2 text-sm leading-6 text-[#737373]">{description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          id={inputId}
          type="file"
          accept="image/*"
          disabled={disabled}
          className="peer sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            onChange(file)
          }}
        />
        <label
          htmlFor={inputId}
          className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#d8d8d8] px-5 text-sm font-semibold tracking-[-0.015em] transition peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[#ff5148]/40 peer-focus-visible:ring-offset-2 ${
            disabled ? 'pointer-events-none cursor-not-allowed bg-[#f3f3f3] text-[#171717]/48' : 'bg-white text-[#111317] hover:border-[#ff5148] hover:text-[#c9342f]'
          }`}
        >
          <ImagePlus className="h-4 w-4" />
          {isProcessing ? '이미지 처리 중…' : actionLabel}
        </label>
        <span className="text-xs leading-6 text-[#7a7a7a]">{hint}</span>
      </div>
    </div>
  </div>
)

interface ImageSlotDraft {
  id: string
  slot: string
  usage: string
  trigger: string
  priority: string
  assets: ResizedImageAsset[]
  previewUrl: string
  sourceSize: string
  existingThumbUrl: string
  existingCardUrl: string
  existingDetailUrl: string
}

const createSlotId = () => `slot-${Math.random().toString(36).slice(2, 10)}`
const isCanonicalSlotId = (value: string) => /^[A-Za-z0-9_-]{1,32}$/.test(value)

const toEntitySlotVariants = (slotId: string, variants: typeof CHARACTER_VARIANTS | typeof WORLD_VARIANTS) =>
  variants.map((variant) => ({
    ...variant,
    kind: `${slotId}:${variant.kind}`,
  }))

const createImageSlotDraft = (slot: string, usage: string, trigger: string, priority: string): ImageSlotDraft => ({
  id: createSlotId(),
  slot,
  usage,
  trigger,
  priority,
  assets: [],
  previewUrl: '',
  sourceSize: '',
  existingThumbUrl: '',
  existingCardUrl: '',
  existingDetailUrl: '',
})

const createDraftFromExistingSlot = (slot: {
  id: string
  slot: string
  usage?: string
  trigger?: string
  priority?: number
  detailUrl?: string
  cardUrl?: string
  thumbUrl?: string
}): ImageSlotDraft => ({
  id: isCanonicalSlotId(slot.id) ? slot.id : createSlotId(),
  slot: slot.slot || 'main',
  usage: slot.usage || slot.slot || '',
  trigger: slot.trigger || '',
  priority: String(slot.priority ?? 100),
  assets: [],
  previewUrl: slot.detailUrl || slot.cardUrl || slot.thumbUrl || '',
  sourceSize: '',
  existingThumbUrl: slot.thumbUrl || '',
  existingCardUrl: slot.cardUrl || '',
  existingDetailUrl: slot.detailUrl || '',
})

type EditorDraftKind = 'character' | 'world'

interface PersistedImageSlotDraft {
  id: string
  slot: string
  usage: string
  trigger: string
  priority: string
  existingThumbUrl: string
  existingCardUrl: string
  existingDetailUrl: string
}

interface EditorDraftRecord<TValues extends Record<string, unknown>> {
  version: 1
  kind: EditorDraftKind
  revision: string
  updatedAt: string
  values: TValues
  imageSlots: PersistedImageSlotDraft[]
  imageSlotsDirty: boolean
  requiresImageReselection: boolean
}

const editorDraftKey = (kind: EditorDraftKind, slug: string | undefined, userId: string) =>
  `v-mate:editor-draft:v1:${kind}:${encodeURIComponent(slug || 'new')}:${encodeURIComponent(userId)}`

const resolveEditorDraftStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const readEditorDraft = <TValues extends Record<string, unknown>>(key: string, kind: EditorDraftKind): EditorDraftRecord<TValues> | null => {
  const storage = resolveEditorDraftStorage()
  if (!storage) return null
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null') as EditorDraftRecord<TValues> | null
    if (!parsed || parsed.version !== 1 || parsed.kind !== kind || !parsed.values || typeof parsed.values !== 'object' || Array.isArray(parsed.values) || !Array.isArray(parsed.imageSlots) || !parsed.imageSlots.every((slot) => slot && typeof slot === 'object')) {
      storage.removeItem(key)
      return null
    }
    return parsed
  } catch {
    storage.removeItem(key)
    return null
  }
}

const writeEditorDraft = <TValues extends Record<string, unknown>>(key: string, draft: EditorDraftRecord<TValues>) => {
  try {
    resolveEditorDraftStorage()?.setItem(key, JSON.stringify(draft))
  } catch {
    // 임시 저장 실패가 편집 자체를 막아서는 안 된다.
  }
}

const clearEditorDraft = (key: string) => {
  try {
    resolveEditorDraftStorage()?.removeItem(key)
  } catch {
    // 저장 완료 뒤 임시 저장 정리에 실패해도 서버 저장 결과는 유지한다.
  }
}

const createEditorDraftRevision = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const readEditorDraftRevision = (key: string) => {
  try {
    const raw = resolveEditorDraftStorage()?.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return typeof parsed.revision === 'string' && parsed.revision ? parsed.revision : null
  } catch {
    return null
  }
}

const toPersistedImageSlots = (slots: ImageSlotDraft[]) => slots
  .slice(0, 6)
  .map((slot) => ({
    id: slot.id,
    slot: slot.slot,
    usage: slot.usage,
    trigger: slot.trigger,
    priority: slot.priority,
    existingThumbUrl: slot.existingThumbUrl,
    existingCardUrl: slot.existingCardUrl,
    existingDetailUrl: slot.existingDetailUrl,
  }))

const imageSlotsRequireReselection = (slots: ImageSlotDraft[]) => slots.some((slot, index) => (
  slot.assets.length > 0
  || (index > 0 && !slot.existingThumbUrl && !slot.existingCardUrl && !slot.existingDetailUrl)
))

const restorePersistedImageSlots = (slots: PersistedImageSlotDraft[], fallback: ImageSlotDraft) => {
  const restored = slots.slice(0, 6).map((slot) => ({
    id: typeof slot.id === 'string' && isCanonicalSlotId(slot.id) ? slot.id : createSlotId(),
    slot: String(slot.slot || ''),
    usage: String(slot.usage || ''),
    trigger: String(slot.trigger || ''),
    priority: String(slot.priority || '0'),
    assets: [],
    previewUrl: String(slot.existingDetailUrl || slot.existingCardUrl || slot.existingThumbUrl || ''),
    sourceSize: '',
    existingThumbUrl: String(slot.existingThumbUrl || ''),
    existingCardUrl: String(slot.existingCardUrl || ''),
    existingDetailUrl: String(slot.existingDetailUrl || ''),
  }))
  return restored.length > 0 ? restored : [fallback]
}

const isCurrentNavigationTarget = (path: string) => {
  if (typeof window === 'undefined') return false
  try {
    const target = new URL(path, window.location.href)
    const normalize = (pathname: string) => pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
    return normalize(target.pathname) === normalize(window.location.pathname)
      && target.search === window.location.search
      && target.hash === window.location.hash
  } catch {
    return false
  }
}

interface EditorNavigationSnapshot {
  draftKey: string
  draftRevision: string | null
  localGeneration: number
  appGeneration: number | null
}

type PendingEditorNavigation =
  | { kind: 'navigate'; path: string }
  | { kind: 'search'; value: string }

const useEditorIntegrity = (chrome: PlatformPageChromeProps, draftKey: string) => {
  const [imageSlotsDirty, setImageSlotsDirty] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<PendingEditorNavigation | null>(null)
  const isDirtyRef = useRef(false)
  const isMountedRef = useRef(false)
  const pendingNavigationRef = useRef<PendingEditorNavigation | null>(null)
  const isConfirmingNavigationRef = useRef(false)
  const localNavigationGenerationRef = useRef(0)
  const activeDraftKeyRef = useRef(draftKey)
  const chromeRef = useRef(chrome)
  activeDraftKeyRef.current = draftKey
  chromeRef.current = chrome

  const markDirty = () => {
    isDirtyRef.current = true
    setIsDirty(true)
    chromeRef.current.onEditorDirtyChange?.(true)
  }

  const markImageSlotsDirty = () => {
    setImageSlotsDirty(true)
    markDirty()
  }

  const markClean = () => {
    isDirtyRef.current = false
    setIsDirty(false)
    chromeRef.current.onEditorDirtyChange?.(false)
  }

  const guardedNavigate = (path: string) => {
    if (isCurrentNavigationTarget(path)) return
    if (isDirtyRef.current) {
      if (pendingNavigationRef.current) return
      const nextNavigation: PendingEditorNavigation = { kind: 'navigate', path }
      pendingNavigationRef.current = nextNavigation
      setPendingNavigation(nextNavigation)
      return
    }
    localNavigationGenerationRef.current += 1
    chromeRef.current.onNavigate(path)
  }

  const guardedSearchSubmit = (value: string) => {
    if (isDirtyRef.current) {
      if (pendingNavigationRef.current) return
      const nextNavigation: PendingEditorNavigation = { kind: 'search', value }
      pendingNavigationRef.current = nextNavigation
      setPendingNavigation(nextNavigation)
      return
    }
    localNavigationGenerationRef.current += 1
    chromeRef.current.onSearchSubmit(value)
  }

  const cancelNavigation = () => {
    if (isConfirmingNavigationRef.current) return
    pendingNavigationRef.current = null
    setPendingNavigation(null)
  }

  const confirmNavigation = () => {
    const nextNavigation = pendingNavigationRef.current
    if (!nextNavigation || isConfirmingNavigationRef.current) return
    isConfirmingNavigationRef.current = true
    pendingNavigationRef.current = null
    setPendingNavigation(null)
    localNavigationGenerationRef.current += 1
    try {
      if (nextNavigation.kind === 'navigate') chromeRef.current.onNavigate(nextNavigation.path)
      else chromeRef.current.onSearchSubmit(nextNavigation.value)
    } finally {
      isConfirmingNavigationRef.current = false
    }
  }

  const captureNavigation = (): EditorNavigationSnapshot => ({
    draftKey: activeDraftKeyRef.current,
    draftRevision: activeDraftKeyRef.current ? readEditorDraftRevision(activeDraftKeyRef.current) : null,
    localGeneration: localNavigationGenerationRef.current,
    appGeneration: chromeRef.current.getNavigationGeneration?.() ?? null,
  })

  const finishAndNavigate = (path: string, snapshot: EditorNavigationSnapshot) => {
    const currentAppGeneration = chromeRef.current.getNavigationGeneration?.() ?? null
    const navigationIsCurrent = isMountedRef.current
      && activeDraftKeyRef.current === snapshot.draftKey
      && localNavigationGenerationRef.current === snapshot.localGeneration
      && (snapshot.appGeneration === null || currentAppGeneration === snapshot.appGeneration)
    const submittedDraftStillStored = Boolean(snapshot.draftKey)
      && snapshot.draftRevision !== null
      && readEditorDraftRevision(snapshot.draftKey) === snapshot.draftRevision
    if (snapshot.draftKey && submittedDraftStillStored) {
      clearEditorDraft(snapshot.draftKey)
    }
    if (!navigationIsCurrent) return
    pendingNavigationRef.current = null
    setPendingNavigation(null)
    localNavigationGenerationRef.current += 1
    markClean()
    chromeRef.current.onNavigate(path)
  }

  useEffect(() => {
    isMountedRef.current = true
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      isMountedRef.current = false
      pendingNavigationRef.current = null
      chromeRef.current.onEditorDirtyChange?.(false)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  return {
    editorChrome: { ...chrome, onNavigate: guardedNavigate, onSearchSubmit: guardedSearchSubmit } as PlatformPageChromeProps,
    editorNavigationDialog: (
      <UnsavedChangesDialog
        open={pendingNavigation !== null}
        description={pendingNavigation?.kind === 'search'
          ? '검색 결과로 이동하면 현재 입력 내용은 임시저장본으로만 남습니다.'
          : '다른 화면으로 이동하면 현재 입력 내용은 임시저장본으로만 남습니다.'}
        onCancel={cancelNavigation}
        onConfirm={confirmNavigation}
      />
    ),
    captureNavigation,
    finishAndNavigate,
    guardedNavigate,
    imageSlotsDirty,
    isDirty,
    markClean,
    markDirty,
    markImageSlotsDirty,
    setImageSlotsDirty,
  }
}

const useImageProcessingTracker = () => {
  const nextTokenRef = useRef(0)
  const [operations, setOperations] = useState<Record<number, string>>({})
  const processingSlotIds = useMemo(() => new Set(Object.values(operations)), [operations])

  const begin = (slotId: string) => {
    const token = nextTokenRef.current + 1
    nextTokenRef.current = token
    setOperations((current) => ({ ...current, [token]: slotId }))
    return token
  }

  const finish = (token: number) => {
    setOperations((current) => {
      if (!(token in current)) return current
      const next = { ...current }
      delete next[token]
      return next
    })
  }

  return {
    begin,
    finish,
    isProcessing: Object.keys(operations).length > 0,
    processingSlotIds,
  }
}

const uploadPreparedAssets = async ({
  entityType,
  assets,
}: {
  entityType: 'character' | 'world'
  assets: ResizedImageAsset[]
}) => {
  if (assets.length === 0) {
    return [] as Array<{ kind: string; url: string; width: number; height: number }>
  }

  const prepared = await platformApi.prepareUploads({
    entityType,
    variants: assets.map((asset) => ({
      kind: asset.kind,
      width: asset.width,
      height: asset.height,
    })),
  })

  const supabaseModule = await import('@/lib/supabase')
  const supabase = await supabaseModule.resolveSupabaseClient()
  if (!supabase) {
    throw new Error('스토리지 클라이언트를 초기화하지 못했습니다.')
  }

  const uploadedAssets = []
  for (const asset of assets) {
    const target = prepared.uploads.find((item) => item.kind === asset.kind)
    if (!target) {
      throw new Error(`업로드 대상을 찾지 못했습니다: ${asset.kind}`)
    }
    const blob = await fetch(asset.dataUrl).then((response) => response.blob())
    const { error } = await supabase.storage
      .from(target.bucket)
      .uploadToSignedUrl(target.path, target.token, blob, { contentType: 'image/webp', upsert: false })
    if (error) throw error
    uploadedAssets.push({
      kind: asset.kind,
      url: target.publicUrl,
      width: asset.width,
      height: asset.height,
    })
  }
  return uploadedAssets
}

const buildSlotRecord = ({
  slot,
  uploadedAssets,
}: {
  slot: ImageSlotDraft
  uploadedAssets: Array<{ kind: string; url: string; width: number; height: number }>
}) => {
  const variants = uploadedAssets.filter((asset) => asset.kind.startsWith(`${slot.id}:`))
  const findVariant = (variantKind: 'thumb' | 'card' | 'detail' | 'hero') =>
    variants.find((asset) => asset.kind === `${slot.id}:${variantKind}`)?.url || ''

  return {
    id: slot.id,
    slot: slot.slot.trim() || 'custom',
    usage: slot.usage.trim(),
    trigger: slot.trigger.trim(),
    priority: Number(slot.priority || 0),
    thumbUrl: findVariant('thumb') || slot.existingThumbUrl || '',
    cardUrl: findVariant('card') || slot.existingCardUrl || '',
    detailUrl: findVariant('detail') || findVariant('hero') || slot.existingDetailUrl || '',
  }
}

const splitCommaValues = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const deriveSummaryFromPrompt = (headline: string, prompt: string) => {
  const primaryLine = String(prompt || '')
    .split('\n')
    .map((item) => item.replace(/^[-*0-9.)\s]+/, '').trim())
    .find(Boolean)

  return (String(headline || '').trim() || primaryLine || '설명이 아직 없습니다.').slice(0, 120)
}

const PromptGuide = ({ title, bullets }: { title: string; bullets: string[] }) => (
  <details className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4 text-sm leading-6 text-[#626262]">
    <summary className="cursor-pointer font-semibold text-[#171717]">{title}</summary>
    <ul className="mt-3 space-y-2">
      {bullets.map((bullet) => <li key={bullet}>• {bullet}</li>)}
    </ul>
  </details>
)

const SituationImageSlotsEditor = ({
  sectionTitle,
  mainDescription,
  aspectClassName,
  slots,
  isProcessing,
  processingSlotIds,
  inputPrefix,
  onUpload,
  onAdd,
  onUpdate,
  onRemove,
}: {
  sectionTitle: string
  mainDescription: string
  aspectClassName: string
  slots: ImageSlotDraft[]
  isProcessing: boolean
  processingSlotIds: ReadonlySet<string>
  inputPrefix: string
  onUpload: (slotId: string, file: File) => void
  onAdd: () => void
  onUpdate: (slotId: string, patch: Partial<ImageSlotDraft>) => void
  onRemove: (slotId: string) => void
}) => {
  const mainSlot = slots[0]
  if (!mainSlot) return null

  return (
    <div className="space-y-4">
      <FileUploadCard
        inputId={`${inputPrefix}-main-image-upload-input`}
        title="대표 이미지 · 필수"
        description={mainDescription}
        previewUrl={mainSlot.previewUrl}
        previewAlt={`${sectionTitle} 대표 이미지 미리보기`}
        aspectClassName={aspectClassName}
        hint={`현재 원본 ${mainSlot.sourceSize || '미선택'} · 장면에 맞춰 상황별 이미지를 표시합니다.`}
        disabled={isProcessing}
        isProcessing={processingSlotIds.has(mainSlot.id)}
        onChange={(file) => onUpload(mainSlot.id, file)}
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#171717]">상황별 이미지 추가</p>
          <p className="mt-1 text-sm leading-6 text-[#737373]">장면이 바뀔 때 어떤 이미지로 전환할지 슬롯별로 지정합니다. 콘텐츠당 최대 6개입니다.</p>
        </div>
        <Button variant="outline" onClick={onAdd} disabled={isProcessing || slots.length >= 6} title={slots.length >= 6 ? '이미지 슬롯은 최대 6개입니다.' : undefined}>
          <ImagePlus className="h-4 w-4" />상황별 이미지 추가
        </Button>
      </div>

      {slots.slice(1).map((slot) => (
        <div key={slot.id} className="grid gap-4 rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-3">
            <ArtworkFrame src={slot.previewUrl} alt={`${slot.slot || '상황별'} 이미지 미리보기`} aspectClassName={aspectClassName} />
            <input
              id={`${inputPrefix}-${slot.id}-image-upload-input`}
              type="file"
              accept="image/*"
              disabled={isProcessing}
              className="peer sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.currentTarget.value = ''
                if (!file) return
                onUpload(slot.id, file)
              }}
            />
            <label htmlFor={`${inputPrefix}-${slot.id}-image-upload-input`} className={`inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#d8d8d8] px-5 text-sm font-semibold tracking-[-0.015em] transition peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[#ff5148]/40 peer-focus-visible:ring-offset-2 ${isProcessing ? 'pointer-events-none cursor-not-allowed bg-[#f3f3f3] text-[#171717]/48' : 'bg-white text-[#111317] hover:border-[#ff5148] hover:text-[#c9342f]'}`}>
              <ImagePlus className="h-4 w-4" />{processingSlotIds.has(slot.id) ? '이미지 처리 중…' : '이미지 선택'}
            </label>
            <p className="text-xs leading-6 text-[#7a7a7a]">현재 원본 {slot.sourceSize || '미선택'} · 이미지를 올리면 이 슬롯을 사용할 수 있습니다.</p>
          </div>

          <div className="grid min-w-0 gap-4">
            <label className="space-y-2 text-sm font-semibold text-[#555]">
              <span>슬롯 이름</span>
              <Input
                name={`${inputPrefix}-${slot.id}-name`}
                value={slot.slot}
                onChange={(event) => onUpdate(slot.id, { slot: event.target.value, usage: event.target.value })}
                placeholder="예: battle, rain, night"
                className="bg-[#ffffff] font-normal text-[#171717] placeholder:text-[#707070]"
              />
            </label>
            <label className="space-y-2 text-sm font-semibold text-[#555]">
              <span>표시 조건</span>
              <textarea
                name={`${inputPrefix}-${slot.id}-trigger`}
                value={slot.trigger}
                onChange={(event) => onUpdate(slot.id, { trigger: event.target.value })}
                placeholder="예: 말싸움이 격해지거나 긴장감이 높아질 때"
                className="min-h-[140px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-3 text-sm font-normal text-[#171717] placeholder:text-[#707070] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2"
              />
            </label>
            <div className="flex justify-end">
              <Button variant="outline" className="border-[#ff5148]/40 text-[#c9342f] hover:bg-[#ff5148]/10 hover:text-[#171717]" onClick={() => onRemove(slot.id)} disabled={isProcessing}>
                <Trash2 className="h-4 w-4" />슬롯 삭제
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const selectStyle = { colorScheme: 'light' as const }
const CreateTypeTabs = ({ active, onNavigate }: { active: 'character' | 'world'; onNavigate: (path: string) => void }) => (
  <div className="flex items-center justify-between gap-3">
    <h1 className="text-3xl font-black tracking-[-0.05em] text-[#171717]">{active === 'character' ? '캐릭터 만들기' : '월드 만들기'}</h1>
    <nav aria-label="만들기 유형" className="flex rounded-lg border border-[#d8d8d8] bg-white p-1"><NavigationLink path="/create/character" onNavigate={onNavigate} ariaCurrent={active === 'character' ? 'page' : undefined} className={`min-h-10 rounded-md px-3 py-2 text-xs font-bold ${active === 'character' ? 'bg-[#d43a34] text-white' : 'text-[#666666]'}`}>캐릭터</NavigationLink><NavigationLink path="/create/world" onNavigate={onNavigate} ariaCurrent={active === 'world' ? 'page' : undefined} className={`min-h-10 rounded-md px-3 py-2 text-xs font-bold ${active === 'world' ? 'bg-[#d43a34] text-white' : 'text-[#666666]'}`}>월드</NavigationLink></nav>
  </div>
)

const PublishingAttestation = ({ rightsConfirmed, onRightsChange }: { rightsConfirmed: boolean; onRightsChange: (value: boolean) => void }) => (
  <div className="space-y-3 rounded-lg border border-[#e7e7e7] bg-[#fff7f6] p-4 text-sm text-[#5f5551]">
    <p className="font-bold text-[#c9342f]">공개 전 확인</p>
    <label className="flex items-start gap-3"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => onRightsChange(event.target.checked)} className="mt-0.5 size-4 accent-[#ff5148]" /><span>이 콘텐츠와 업로드 이미지의 공개 권리를 보유하고 있습니다.</span></label>
  </div>
)

type CharacterEditorDraftValues = {
  name: string
  headline: string
  tags: string
  sourceType: 'original' | 'derivative'
  sourceUrl: string
  visibility: 'private' | 'public'
  rightsConfirmed: boolean
  characterPrompt: string
  characterIntro: string
}

// 제작 화면은 업로드 준비, 폼 입력, 저장 호출을 한 방향 흐름으로 고정한다.
export function CreateCharacterPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug?: string }) {
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [tags, setTags] = useState('')
  const [sourceType, setSourceType] = useState<'original' | 'derivative'>('original')
  const [sourceUrl, setSourceUrl] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [characterPrompt, setCharacterPrompt] = useState('')
  const [characterIntro, setCharacterIntro] = useState('')
  const { begin: beginImageProcessing, finish: finishImageProcessing, isProcessing: isProcessingImages, processingSlotIds } = useImageProcessingTracker()
  const [isHydrating, setIsHydrating] = useState(Boolean(slug))
  const [hydrationError, setHydrationError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)
  const [canManage, setCanManage] = useState<boolean | null>(slug ? null : true)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [hydratedDraftKey, setHydratedDraftKey] = useState('')
  const [imageSlots, setImageSlots] = useState<ImageSlotDraft[]>(() => [
    createImageSlotDraft('main', '대표 이미지', '기본 대표 비주얼', '100'),
  ])
  const draftKey = chrome.user?.id ? editorDraftKey('character', slug, chrome.user.id) : ''
  const { captureNavigation, editorChrome, editorNavigationDialog, finishAndNavigate, guardedNavigate, imageSlotsDirty, isDirty, markClean, markDirty, markImageSlotsDirty, setImageSlotsDirty } = useEditorIntegrity(chrome, draftKey)

  const restoreDraft = (draft: EditorDraftRecord<CharacterEditorDraftValues>) => {
    const values = draft.values
    setName(String(values.name || ''))
    setHeadline(String(values.headline || ''))
    setTags(String(values.tags || ''))
    setSourceType(values.sourceType === 'derivative' ? 'derivative' : 'original')
    setSourceUrl(String(values.sourceUrl || ''))
    setVisibility(values.visibility === 'public' ? 'public' : 'private')
    setRightsConfirmed(Boolean(values.rightsConfirmed))
    setCharacterPrompt(String(values.characterPrompt || ''))
    setCharacterIntro(String(values.characterIntro || ''))
    setImageSlots(restorePersistedImageSlots(draft.imageSlots, createImageSlotDraft('main', '대표 이미지', '기본 대표 비주얼', '100')))
    setImageSlotsDirty(Boolean(draft.imageSlotsDirty))
    markDirty()
    toast.info(draft.requiresImageReselection
      ? '임시 저장된 내용을 복원했습니다. 새 이미지와 미완성 이미지 슬롯은 다시 선택해 주세요.'
      : '임시 저장된 내용을 복원했습니다.')
  }

  const updateSlot = (slotId: string, patch: Partial<ImageSlotDraft>) => {
    setImageSlots((prev) => prev.map((slot) => slot.id === slotId ? { ...slot, ...patch } : slot))
    markImageSlotsDirty()
  }

  const handleSlotUpload = (slotId: string, file: File) => {
    // File bytes cannot be restored from sessionStorage. Mark the editor dirty
    // before asynchronous resizing starts so Back/navigation cannot discard the
    // user's selection during the processing window.
    markImageSlotsDirty()
    const processingToken = beginImageProcessing(slotId)
    void createImageVariants({ file, variants: toEntitySlotVariants(slotId, CHARACTER_VARIANTS) })
      .then((assets) => {
        const preview = assets.find((asset) => asset.kind.endsWith(':detail')) || assets[0]
        updateSlot(slotId, {
          assets,
          previewUrl: preview?.dataUrl || '',
          sourceSize: preview ? `${preview.sourceWidth}×${preview.sourceHeight}` : '',
        })
        toast.success('이미지 파생본을 생성했습니다.')
      })
      .catch(() => toast.error(imageProcessingFailureMessage()))
      .finally(() => finishImageProcessing(processingToken))
  }

  const mainSlot = imageSlots[0]!
  const creatorName = String(chrome.user?.user_metadata?.name || chrome.user?.email || '').trim()

  useEffect(() => {
    if (slug || !draftKey || hydratedDraftKey === draftKey) return
    setHydratedDraftKey('')
    const draft = readEditorDraft<CharacterEditorDraftValues>(draftKey, 'character')
    if (draft) restoreDraft(draft)
    else {
      setName('')
      setHeadline('')
      setTags('')
      setSourceType('original')
      setSourceUrl('')
      setVisibility('private')
      setRightsConfirmed(false)
      setCharacterPrompt('')
      setCharacterIntro('')
      setImageSlots([createImageSlotDraft('main', '대표 이미지', '기본 대표 비주얼', '100')])
      setImageSlotsDirty(false)
      markClean()
    }
    setHydratedDraftKey(draftKey)
  }, [draftKey, hydratedDraftKey, slug])

  useEffect(() => {
    if (!slug) return
    let mounted = true
    setIsHydrating(true)
    setHydratedDraftKey('')
    setCanManage(null)
    setName('')
    setHeadline('')
    setTags('')
    setSourceType('original')
    setSourceUrl('')
    setVisibility('private')
    setRightsConfirmed(false)
    setCharacterPrompt('')
    setCharacterIntro('')
    setImageSlots([createImageSlotDraft('main', '대표 이미지', '기본 대표 비주얼', '100')])
    setImageSlotsDirty(false)
    markClean()
    setHydrationError('')
    void platformApi.fetchCharacter(slug)
      .then(({ item }) => {
        if (!mounted) return
        const ownsItem = item.creator.id === chrome.user?.id
        setCanManage(ownsItem)
        if (!ownsItem) {
          return
        }
        setName(item.name)
        setHeadline(item.headline || '')
        setTags(item.tags.join(', '))
        setSourceType((item.sourceType as 'original' | 'derivative') || 'original')
        setSourceUrl(item.sourceUrl || '')
        setVisibility(item.visibility === 'public' ? 'public' : 'private')
        setRightsConfirmed(Boolean(item.rightsAttestedAt))
        setCharacterPrompt(String(item.promptProfileJson?.masterPrompt || item.summary || ''))
        setCharacterIntro(String(item.promptProfileJson?.characterIntro || ''))
        setImageSlots(item.imageSlots?.length ? item.imageSlots.map((slot) => createDraftFromExistingSlot(slot)) : [createImageSlotDraft('main', '대표 이미지', '기본 대표 비주얼', '100')])
        const draft = draftKey ? readEditorDraft<CharacterEditorDraftValues>(draftKey, 'character') : null
        if (draft) restoreDraft(draft)
        else markClean()
        setHydratedDraftKey(draftKey)
      })
      .catch((error) => { if (mounted) setHydrationError(safeActionError(error, '캐릭터 정보를 불러오지 못했습니다. 저장된 데이터는 변경되지 않았습니다. 다시 시도해 주세요.')) })
      .finally(() => { if (mounted) setIsHydrating(false) })
    return () => { mounted = false }
  }, [draftKey, slug, chrome.user?.id])

  useEffect(() => {
    if (!draftKey || hydratedDraftKey !== draftKey || !isDirty) return
    const persistedSlots = toPersistedImageSlots(imageSlots)
    writeEditorDraft<CharacterEditorDraftValues>(draftKey, {
      version: 1,
      kind: 'character',
      revision: createEditorDraftRevision(),
      updatedAt: new Date().toISOString(),
      values: { name, headline, tags, sourceType, sourceUrl, visibility, rightsConfirmed, characterPrompt, characterIntro },
      imageSlots: persistedSlots,
      imageSlotsDirty,
      requiresImageReselection: isProcessingImages || imageSlotsRequireReselection(imageSlots),
    })
  }, [characterIntro, characterPrompt, draftKey, headline, hydratedDraftKey, imageSlots, imageSlotsDirty, isDirty, isProcessingImages, name, rightsConfirmed, sourceType, sourceUrl, tags, visibility])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인이 필요합니다" description="로그인하면 캐릭터를 만들고 저장할 수 있습니다." />
  }

  if (slug && isHydrating) {
    return <PageFrame chrome={chrome} showCombinationDock={false}><LoadingState label="캐릭터 정보 불러오는 중…" /></PageFrame>
  }

  if (slug && canManage === false) {
    return (
      <PageFrame chrome={chrome}>
        <EmptyState
          title="수정 권한이 없습니다"
          description="이 캐릭터는 제작자만 수정할 수 있습니다."
          action={<Button onClick={() => chrome.onNavigate(`/characters/${slug}`)}>상세로 돌아가기</Button>}
        />
      </PageFrame>
    )
  }

  if (slug && hydrationError) {
    return <PageFrame chrome={chrome}><EmptyState title="캐릭터 정보를 불러오지 못했습니다" description={hydrationError} action={<Button onClick={() => chrome.onNavigate(`/characters/${slug}`)}>상세로 돌아가기</Button>} /></PageFrame>
  }

  const derivedSummary = deriveSummaryFromPrompt(headline, characterPrompt)

  return (
    <PageFrame chrome={editorChrome} showCombinationDock={false}>
      {editorNavigationDialog}
      <OwnedContentDeleteDialog
        open={pendingDelete}
        title="캐릭터를 삭제할까요?"
        description="삭제하면 연결된 이미지와 관련 데이터가 함께 정리됩니다."
        itemName={name || '이 캐릭터'}
        isDeleting={isDeleting}
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => {
          if (!slug) return
          const navigationSnapshot = captureNavigation()
          setIsDeleting(true)
          void platformApi.deleteCharacter(slug)
            .then(() => {
              toast.success('캐릭터를 삭제했습니다.')
              finishAndNavigate('/library', navigationSnapshot)
            })
            .catch((error) => toast.error(safeActionError(error, '캐릭터 삭제 결과를 확인하지 못했습니다. 보관함을 다시 불러와 현재 상태를 확인해 주세요.')))
            .finally(() => {
              setIsDeleting(false)
              setPendingDelete(false)
            })
        }}
      />
      <fieldset disabled={isSaving || isDeleting} aria-busy={isSaving || isDeleting} className="mx-auto w-full min-w-0 max-w-4xl space-y-6 border-0 p-0">
        <CreateTypeTabs active="character" onNavigate={guardedNavigate} />
        <PageSection title="기본 정보">
          <div className="grid gap-4">
            <label htmlFor="character-name" className="space-y-2 text-sm font-semibold text-[#555]"><span>이름 · 필수</span><Input id="character-name" name="character-name" required value={name} onChange={(event) => { setName(event.target.value); markDirty() }} placeholder="캐릭터 이름" className="bg-[#ffffff] font-normal text-[#171717] placeholder:text-[#707070]" /></label>
            <label htmlFor="character-headline" className="space-y-2 text-sm font-semibold text-[#555]"><span>한 줄 소개 · 필수</span><Input id="character-headline" name="character-headline" required value={headline} onChange={(event) => { setHeadline(event.target.value); markDirty() }} placeholder="캐릭터를 한 문장으로 소개하세요" className="bg-[#ffffff] font-normal text-[#171717] placeholder:text-[#707070]" /></label>
            <label htmlFor="character-tags" className="space-y-2 text-sm font-semibold text-[#555]"><span>태그 · 선택</span><Input id="character-tags" name="character-tags" value={tags} onChange={(event) => { setTags(event.target.value); markDirty() }} placeholder="미스터리, 일상, 로맨스" className="bg-[#ffffff] font-normal text-[#171717] placeholder:text-[#707070]" /></label>
            <label className="space-y-2 text-sm font-semibold text-[#555]">
              <span>공개 범위</span>
              <select name="character-visibility" value={visibility} onChange={(event) => { setVisibility(event.target.value as typeof visibility); markDirty() }} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 font-normal text-[#171717] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2" style={selectStyle}>
                <option value="private">비공개로 저장</option><option value="public">전체 공개</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-[#555]">
              <span>원작 여부</span>
              <select name="character-source-type" value={sourceType} onChange={(event) => { setSourceType(event.target.value as typeof sourceType); markDirty() }} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 font-normal text-[#171717] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2" style={selectStyle}>
                <option value="original">오리지널</option><option value="derivative">2차창작</option>
              </select>
            </label>
            {sourceType === 'derivative' ? <label htmlFor="character-source-url" className="space-y-2 text-sm font-semibold text-[#555]"><span>원작 또는 출처 URL</span><Input id="character-source-url" name="character-source-url" type="url" value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); markDirty() }} placeholder="https://…" className="font-normal" /></label> : null}
            {visibility === 'public' ? <PublishingAttestation rightsConfirmed={rightsConfirmed} onRightsChange={(value) => { setRightsConfirmed(value); markDirty() }} /> : null}
          </div>
        </PageSection>

        <PageSection title="캐릭터 설정">
          <div className="space-y-4">
            <PromptGuide
              title="작성 가이드"
              bullets={[
                '정체성, 배경, 관계의 출발점.',
                '말투, 문장 길이, 자주 쓰거나 피할 표현.',
                '갈등과 감정에 따른 행동 변화.',
                '유지해야 할 설정과 상황별 이미지 조건.',
              ]}
            />
            <label htmlFor="character-prompt" className="text-sm font-semibold text-[#555]">상세 설정 · 필수</label>
            <textarea
              id="character-prompt"
              name="character-prompt"
              required
              value={characterPrompt}
              onChange={(event) => { setCharacterPrompt(event.target.value); markDirty() }}
              placeholder={[
                '정체성: 무심한 척하지만 상대를 세심하게 챙긴다.',
                '말투: 짧은 반말. 감정이 올라가면 더 직설적으로 말한다.',
                '관계: 처음에는 거리를 두지만 솔직한 상대에게 빠르게 마음을 연다.',
                '유지 규칙: 과장된 밈 말투를 피하고, 긴장 장면에는 battle 이미지를 사용한다.',
              ].join('\n')}
              className="min-h-[320px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-4 text-[15px] leading-7 text-[#171717] placeholder:text-[#707070] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2"
            />
          </div>
        </PageSection>

        <PageSection title="대화 시작 설정">
          <div className="space-y-3">
            <label htmlFor="character-intro" className="text-sm font-semibold text-[#555]">첫 메시지 설정 · 선택</label>
            <p className="text-sm leading-6 text-[#6f6f6f]">대화를 시작할 때의 장소와 태도를 적어 주세요.</p>
            <textarea
              id="character-intro"
              name="character-intro"
              value={characterIntro}
              onChange={(event) => { setCharacterIntro(event.target.value); markDirty() }}
              placeholder="예) 사용자를 한 번 살핀 뒤 짧게 먼저 말을 건다. 경계는 있지만 무례하지 않고, 호기심이 먼저 보인다."
              className="min-h-[120px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-4 text-[15px] leading-7 text-[#171717] placeholder:text-[#707070] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2"
            />
          </div>
        </PageSection>

        <PageSection title="캐릭터 이미지">
          <div className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-3 text-sm text-[#626262]">
            권장 3:4 · 최소 768×1024 · JPG, PNG, WebP · 업로드 후 WebP로 저장됩니다.
          </div>
          <SituationImageSlotsEditor
            sectionTitle={name || '캐릭터'}
            mainDescription="카드와 대화 화면에 기본으로 표시할 이미지입니다."
            aspectClassName="aspect-[3/4]"
            slots={imageSlots}
            isProcessing={isProcessingImages}
            processingSlotIds={processingSlotIds}
            inputPrefix="character"
            onUpload={handleSlotUpload}
            onAdd={() => { setImageSlots((prev) => prev.length >= 6 ? prev : [...prev, createImageSlotDraft(`scene-${prev.length}`, `scene-${prev.length}`, '', String(Math.max(10, 100 - prev.length * 10)))]); markImageSlotsDirty() }}
            onUpdate={updateSlot}
            onRemove={(slotId) => { setImageSlots((prev) => prev.filter((slot) => slot.id !== slotId)); markImageSlotsDirty() }}
          />
        </PageSection>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {slug ? (
            <Button variant="outline" className="border-[#ff5148]/40 text-[#c9342f] hover:bg-[#ff5148]/10 hover:text-[#171717]" onClick={() => setPendingDelete(true)} disabled={isHydrating || isProcessingImages || isDeleting || canManage !== true}>
              <Trash2 className="h-4 w-4" />캐릭터 삭제
            </Button>
          ) : <span />}
          <Button disabled={isHydrating || isSaving || isProcessingImages || !name.trim() || !headline.trim() || !characterPrompt.trim() || !mainSlot.previewUrl || (visibility === 'public' && !rightsConfirmed)} onClick={() => {
            if (isSavingRef.current) return
            const navigationSnapshot = captureNavigation()
            isSavingRef.current = true
            setIsSaving(true)
            void (async () => {
              const slotAssets = imageSlots.flatMap((slot) => slot.assets)
              const uploadedAssets = slotAssets.length > 0
                ? await uploadPreparedAssets({ entityType: 'character', assets: slotAssets })
                : []
              const imageSlotRecords = imageSlots.map((slot) => buildSlotRecord({ slot, uploadedAssets }))
              const mainRecord = imageSlotRecords[0]
              const detailUrl = mainRecord?.detailUrl || ''
              const cardUrl = mainRecord?.cardUrl || detailUrl
              const hasNewMainAssets = uploadedAssets.some((asset) => asset.kind.startsWith(`${mainSlot.id}:`))
              const includeAssetChanges = !slug || uploadedAssets.length > 0
              const includeImageSlotChanges = !slug || imageSlotsDirty || uploadedAssets.length > 0
              const payload = {
                name,
                headline,
                summary: derivedSummary,
                tags: splitCommaValues(tags),
                visibility,
                sourceType,
                sourceUrl: sourceType === 'derivative' ? sourceUrl.trim() : '',
                rightsConfirmed,
                creatorName,
                ...(!slug || hasNewMainAssets ? { coverImageUrl: detailUrl, avatarImageUrl: cardUrl } : {}),
                ...(includeAssetChanges ? { assets: uploadedAssets } : {}),
                profileJson: {
                  prompt: characterPrompt,
                  creatorName,
                },
                speechStyleJson: {
                  prompt: characterPrompt,
                },
                promptProfileJson: {
                  masterPrompt: characterPrompt.trim(),
                  characterIntro: characterIntro.trim(),
                  persona: characterPrompt.trim() ? [characterPrompt.trim()] : [],
                  speechStyle: headline.trim() ? [headline.trim()] : [],
                  relationshipBaseline: '처음 관계는 캐릭터 프롬프트 지시를 따른다.',
                  ...(includeImageSlotChanges ? { imageSlots: imageSlotRecords } : {}),
                  creatorName,
                },
              }
              const { item } = slug
                ? await platformApi.updateCharacter(slug, payload)
                : await platformApi.createCharacter(payload)
              toast.success(slug ? '캐릭터를 수정했습니다.' : '캐릭터를 만들었습니다.')
              finishAndNavigate(`/characters/${item.slug}`, navigationSnapshot)
            })().catch((error) => toast.error(safeActionError(error, `캐릭터를 ${slug ? '수정' : '저장'}하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.`))).finally(() => { isSavingRef.current = false; setIsSaving(false) })
          }}>{isSaving || isHydrating || isProcessingImages ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}{isHydrating ? '불러오는 중…' : isProcessingImages ? '이미지 처리 중…' : isSaving ? '저장 중…' : slug ? '캐릭터 수정' : '캐릭터 저장'}</Button>
        </div>
      </fieldset>
    </PageFrame>
  )
}

type WorldEditorDraftValues = {
  name: string
  headline: string
  tags: string
  sourceType: 'original' | 'derivative'
  sourceUrl: string
  visibility: 'private' | 'public'
  rightsConfirmed: boolean
  worldPrompt: string
  worldIntro: string
}

export function CreateWorldPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug?: string }) {
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [tags, setTags] = useState('')
  const [sourceType, setSourceType] = useState<'original' | 'derivative'>('original')
  const [sourceUrl, setSourceUrl] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [worldPrompt, setWorldPrompt] = useState('')
  const [worldIntro, setWorldIntro] = useState('')
  const { begin: beginImageProcessing, finish: finishImageProcessing, isProcessing: isProcessingImages, processingSlotIds } = useImageProcessingTracker()
  const [isHydrating, setIsHydrating] = useState(Boolean(slug))
  const [hydrationError, setHydrationError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)
  const [canManage, setCanManage] = useState<boolean | null>(slug ? null : true)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [hydratedDraftKey, setHydratedDraftKey] = useState('')
  const [imageSlots, setImageSlots] = useState<ImageSlotDraft[]>(() => [
    createImageSlotDraft('main', '대표 이미지', '기본 월드 비주얼', '100'),
  ])
  const draftKey = chrome.user?.id ? editorDraftKey('world', slug, chrome.user.id) : ''
  const { captureNavigation, editorChrome, editorNavigationDialog, finishAndNavigate, guardedNavigate, imageSlotsDirty, isDirty, markClean, markDirty, markImageSlotsDirty, setImageSlotsDirty } = useEditorIntegrity(chrome, draftKey)

  const restoreDraft = (draft: EditorDraftRecord<WorldEditorDraftValues>) => {
    const values = draft.values
    setName(String(values.name || ''))
    setHeadline(String(values.headline || ''))
    setTags(String(values.tags || ''))
    setSourceType(values.sourceType === 'derivative' ? 'derivative' : 'original')
    setSourceUrl(String(values.sourceUrl || ''))
    setVisibility(values.visibility === 'public' ? 'public' : 'private')
    setRightsConfirmed(Boolean(values.rightsConfirmed))
    setWorldPrompt(String(values.worldPrompt || ''))
    setWorldIntro(String(values.worldIntro || ''))
    setImageSlots(restorePersistedImageSlots(draft.imageSlots, createImageSlotDraft('main', '대표 이미지', '기본 월드 비주얼', '100')))
    setImageSlotsDirty(Boolean(draft.imageSlotsDirty))
    markDirty()
    toast.info(draft.requiresImageReselection
      ? '임시 저장된 내용을 복원했습니다. 새 이미지와 미완성 이미지 슬롯은 다시 선택해 주세요.'
      : '임시 저장된 내용을 복원했습니다.')
  }

  const updateSlot = (slotId: string, patch: Partial<ImageSlotDraft>) => {
    setImageSlots((prev) => prev.map((slot) => slot.id === slotId ? { ...slot, ...patch } : slot))
    markImageSlotsDirty()
  }

  const handleSlotUpload = (slotId: string, file: File) => {
    // Keep navigation guarded while the selected file is still being resized;
    // binary input cannot be reconstructed from the session draft.
    markImageSlotsDirty()
    const processingToken = beginImageProcessing(slotId)
    void createImageVariants({ file, variants: toEntitySlotVariants(slotId, WORLD_VARIANTS) })
      .then((assets) => {
        const preview = assets.find((asset) => asset.kind.endsWith(':hero')) || assets[0]
        updateSlot(slotId, {
          assets,
          previewUrl: preview?.dataUrl || '',
          sourceSize: preview ? `${preview.sourceWidth}×${preview.sourceHeight}` : '',
        })
        toast.success('월드 이미지 파생본을 생성했습니다.')
      })
      .catch(() => toast.error(imageProcessingFailureMessage()))
      .finally(() => finishImageProcessing(processingToken))
  }

  const mainSlot = imageSlots[0]!
  const derivedSummary = deriveSummaryFromPrompt(headline, worldPrompt)
  const creatorName = String(chrome.user?.user_metadata?.name || chrome.user?.email || '').trim()

  useEffect(() => {
    if (slug || !draftKey || hydratedDraftKey === draftKey) return
    setHydratedDraftKey('')
    const draft = readEditorDraft<WorldEditorDraftValues>(draftKey, 'world')
    if (draft) restoreDraft(draft)
    else {
      setName('')
      setHeadline('')
      setTags('')
      setSourceType('original')
      setSourceUrl('')
      setVisibility('private')
      setRightsConfirmed(false)
      setWorldPrompt('')
      setWorldIntro('')
      setImageSlots([createImageSlotDraft('main', '대표 이미지', '기본 월드 비주얼', '100')])
      setImageSlotsDirty(false)
      markClean()
    }
    setHydratedDraftKey(draftKey)
  }, [draftKey, hydratedDraftKey, slug])

  useEffect(() => {
    if (!slug) return
    let mounted = true
    setIsHydrating(true)
    setHydratedDraftKey('')
    setCanManage(null)
    setName('')
    setHeadline('')
    setTags('')
    setSourceType('original')
    setSourceUrl('')
    setVisibility('private')
    setRightsConfirmed(false)
    setWorldPrompt('')
    setWorldIntro('')
    setImageSlots([createImageSlotDraft('main', '대표 이미지', '기본 월드 비주얼', '100')])
    setImageSlotsDirty(false)
    markClean()
    setHydrationError('')
    void platformApi.fetchWorld(slug)
      .then(({ item }) => {
        if (!mounted) return
        const ownsItem = item.creator.id === chrome.user?.id
        setCanManage(ownsItem)
        if (!ownsItem) {
          return
        }
        setName(item.name)
        setHeadline(item.headline || '')
        setTags(item.tags.join(', '))
        setSourceType((item.sourceType as 'original' | 'derivative') || 'original')
        setSourceUrl(item.sourceUrl || '')
        setVisibility(item.visibility === 'public' ? 'public' : 'private')
        setRightsConfirmed(Boolean(item.rightsAttestedAt))
        setWorldPrompt(String(item.promptProfileJson?.masterPrompt || item.summary || ''))
        setWorldIntro(String(item.promptProfileJson?.worldIntro || ''))
        setImageSlots(item.imageSlots?.length ? item.imageSlots.map((slot) => createDraftFromExistingSlot(slot)) : [createImageSlotDraft('main', '대표 이미지', '기본 월드 비주얼', '100')])
        const draft = draftKey ? readEditorDraft<WorldEditorDraftValues>(draftKey, 'world') : null
        if (draft) restoreDraft(draft)
        else markClean()
        setHydratedDraftKey(draftKey)
      })
      .catch((error) => { if (mounted) setHydrationError(safeActionError(error, '월드 정보를 불러오지 못했습니다. 저장된 데이터는 변경되지 않았습니다. 다시 시도해 주세요.')) })
      .finally(() => { if (mounted) setIsHydrating(false) })
    return () => { mounted = false }
  }, [draftKey, slug, chrome.user?.id])

  useEffect(() => {
    if (!draftKey || hydratedDraftKey !== draftKey || !isDirty) return
    const persistedSlots = toPersistedImageSlots(imageSlots)
    writeEditorDraft<WorldEditorDraftValues>(draftKey, {
      version: 1,
      kind: 'world',
      revision: createEditorDraftRevision(),
      updatedAt: new Date().toISOString(),
      values: { name, headline, tags, sourceType, sourceUrl, visibility, rightsConfirmed, worldPrompt, worldIntro },
      imageSlots: persistedSlots,
      imageSlotsDirty,
      requiresImageReselection: isProcessingImages || imageSlotsRequireReselection(imageSlots),
    })
  }, [draftKey, headline, hydratedDraftKey, imageSlots, imageSlotsDirty, isDirty, isProcessingImages, name, rightsConfirmed, sourceType, sourceUrl, tags, visibility, worldIntro, worldPrompt])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인이 필요합니다" description="로그인하면 월드를 만들고 저장할 수 있습니다." />
  }

  if (slug && isHydrating) {
    return <PageFrame chrome={chrome} showCombinationDock={false}><LoadingState label="월드 정보 불러오는 중…" /></PageFrame>
  }

  if (slug && canManage === false) {
    return (
      <PageFrame chrome={chrome}>
        <EmptyState
          title="수정 권한이 없습니다"
          description="이 월드는 제작자만 수정할 수 있습니다."
          action={<Button onClick={() => chrome.onNavigate(`/worlds/${slug}`)}>상세로 돌아가기</Button>}
        />
      </PageFrame>
    )
  }

  if (slug && hydrationError) {
    return <PageFrame chrome={chrome}><EmptyState title="월드 정보를 불러오지 못했습니다" description={hydrationError} action={<Button onClick={() => chrome.onNavigate(`/worlds/${slug}`)}>상세로 돌아가기</Button>} /></PageFrame>
  }

  return (
    <PageFrame chrome={editorChrome} showCombinationDock={false}>
      {editorNavigationDialog}
      <OwnedContentDeleteDialog
        open={pendingDelete}
        title="월드를 삭제할까요?"
        description="삭제하면 연결된 이미지와 관련 데이터가 함께 정리됩니다."
        itemName={name || '이 월드'}
        isDeleting={isDeleting}
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => {
          if (!slug) return
          const navigationSnapshot = captureNavigation()
          setIsDeleting(true)
          void platformApi.deleteWorld(slug)
            .then(() => {
              toast.success('월드를 삭제했습니다.')
              finishAndNavigate('/library', navigationSnapshot)
            })
            .catch((error) => toast.error(safeActionError(error, '월드 삭제 결과를 확인하지 못했습니다. 보관함을 다시 불러와 현재 상태를 확인해 주세요.')))
            .finally(() => {
              setIsDeleting(false)
              setPendingDelete(false)
            })
        }}
      />
      <fieldset disabled={isSaving || isDeleting} aria-busy={isSaving || isDeleting} className="mx-auto w-full min-w-0 max-w-4xl space-y-6 border-0 p-0">
        <CreateTypeTabs active="world" onNavigate={guardedNavigate} />
        <PageSection title="기본 정보">
          <div className="grid gap-4">
            <label htmlFor="world-name" className="space-y-2 text-sm font-semibold text-[#555]"><span>이름 · 필수</span><Input id="world-name" name="world-name" required value={name} onChange={(event) => { setName(event.target.value); markDirty() }} placeholder="월드 이름" className="bg-[#ffffff] font-normal text-[#171717] placeholder:text-[#707070]" /></label>
            <label htmlFor="world-headline" className="space-y-2 text-sm font-semibold text-[#555]"><span>한 줄 소개 · 필수</span><Input id="world-headline" name="world-headline" required value={headline} onChange={(event) => { setHeadline(event.target.value); markDirty() }} placeholder="월드를 한 문장으로 소개하세요" className="bg-[#ffffff] font-normal text-[#171717] placeholder:text-[#707070]" /></label>
            <label htmlFor="world-tags" className="space-y-2 text-sm font-semibold text-[#555]"><span>태그 · 선택</span><Input id="world-tags" name="world-tags" value={tags} onChange={(event) => { setTags(event.target.value); markDirty() }} placeholder="현대, 도시, 미스터리" className="bg-[#ffffff] font-normal text-[#171717] placeholder:text-[#707070]" /></label>
            <label className="space-y-2 text-sm font-semibold text-[#555]">
              <span>공개 범위</span>
              <select name="world-visibility" value={visibility} onChange={(event) => { setVisibility(event.target.value as typeof visibility); markDirty() }} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 font-normal text-[#171717] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2" style={selectStyle}>
                <option value="private">비공개로 저장</option><option value="public">전체 공개</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-[#555]">
              <span>원작 여부</span>
              <select name="world-source-type" value={sourceType} onChange={(event) => { setSourceType(event.target.value as typeof sourceType); markDirty() }} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 font-normal text-[#171717] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2" style={selectStyle}>
                <option value="original">오리지널</option><option value="derivative">2차창작</option>
              </select>
            </label>
            {sourceType === 'derivative' ? <label htmlFor="world-source-url" className="space-y-2 text-sm font-semibold text-[#555]"><span>원작 또는 출처 URL</span><Input id="world-source-url" name="world-source-url" type="url" value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); markDirty() }} placeholder="https://…" className="font-normal" /></label> : null}
            {visibility === 'public' ? <PublishingAttestation rightsConfirmed={rightsConfirmed} onRightsChange={(value) => { setRightsConfirmed(value); markDirty() }} /> : null}
          </div>
        </PageSection>

        <PageSection title="월드 설정">
          <div className="space-y-4">
            <PromptGuide
              title="작성 가이드"
              bullets={[
                '장르, 시대, 분위기.',
                '시작 장소와 사건, 반복해서 등장할 공간과 용어.',
                '유지해야 할 규칙과 피해야 할 전개.',
                '상황별 이미지가 바뀌는 조건.',
              ]}
            />
            <label htmlFor="world-prompt" className="text-sm font-semibold text-[#555]">상세 설정 · 필수</label>
            <textarea
              id="world-prompt"
              name="world-prompt"
              required
              value={worldPrompt}
              onChange={(event) => { setWorldPrompt(event.target.value); markDirty() }}
              placeholder={[
                '분위기: 비가 자주 오는 현실 도시. 심야의 정적이 중요하다.',
                '시작: 편의점 앞, 횡단보도, 비 젖은 골목 중 한 곳에서 시작한다.',
                '유지 규칙: 현실적인 대사와 공간감을 유지하고 갑작스러운 코미디 전개를 피한다.',
                '이미지: 비가 강해지면 rain, 밤거리가 강조되면 neon-night 이미지를 사용한다.',
              ].join('\n')}
              className="min-h-[320px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-4 text-[15px] leading-7 text-[#171717] placeholder:text-[#707070] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2"
            />
          </div>
        </PageSection>

        <PageSection title="시작 장면">
          <div className="space-y-3">
            <label htmlFor="world-intro" className="text-sm font-semibold text-[#555]">시작 장면 · 선택</label>
            <p className="text-sm leading-6 text-[#6f6f6f]">대화를 시작할 장소와 상황을 적어 주세요.</p>
            <textarea
              id="world-intro"
              name="world-intro"
              value={worldIntro}
              onChange={(event) => { setWorldIntro(event.target.value); markDirty() }}
              placeholder="예) 비가 막 그친 편의점 앞에서 시작한다. 막차가 얼마 남지 않아 시간이 촉박하고, 주변 공기는 조용하지만 눅눅한 긴장감이 있다."
              className="min-h-[120px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-4 text-[15px] leading-7 text-[#171717] placeholder:text-[#707070] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2"
            />
          </div>
        </PageSection>

        <PageSection title="월드 이미지">
          <div className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-3 text-sm text-[#626262]">
            권장 16:9 · 최소 1280×720 · JPG, PNG, WebP · 업로드 후 WebP로 저장됩니다.
          </div>
          <SituationImageSlotsEditor
            sectionTitle={name || '월드'}
            mainDescription="카드와 대화 화면에 기본으로 표시할 이미지입니다."
            aspectClassName="aspect-[16/9]"
            slots={imageSlots}
            isProcessing={isProcessingImages}
            processingSlotIds={processingSlotIds}
            inputPrefix="world"
            onUpload={handleSlotUpload}
            onAdd={() => { setImageSlots((prev) => prev.length >= 6 ? prev : [...prev, createImageSlotDraft(`scene-${prev.length}`, `scene-${prev.length}`, '', String(Math.max(10, 100 - prev.length * 10)))]); markImageSlotsDirty() }}
            onUpdate={updateSlot}
            onRemove={(slotId) => { setImageSlots((prev) => prev.filter((slot) => slot.id !== slotId)); markImageSlotsDirty() }}
          />
        </PageSection>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {slug ? (
            <Button variant="outline" className="border-[#ff5148]/40 text-[#c9342f] hover:bg-[#ff5148]/10 hover:text-[#171717]" onClick={() => setPendingDelete(true)} disabled={isHydrating || isProcessingImages || isDeleting || canManage !== true}>
              <Trash2 className="h-4 w-4" />월드 삭제
            </Button>
          ) : <span />}
          <Button disabled={isHydrating || isSaving || isProcessingImages || !name.trim() || !headline.trim() || !worldPrompt.trim() || !mainSlot.previewUrl || (visibility === 'public' && !rightsConfirmed)} onClick={() => {
            if (isSavingRef.current) return
            const navigationSnapshot = captureNavigation()
            isSavingRef.current = true
            setIsSaving(true)
            void (async () => {
              const slotAssets = imageSlots.flatMap((slot) => slot.assets)
              const uploadedAssets = slotAssets.length > 0
                ? await uploadPreparedAssets({ entityType: 'world', assets: slotAssets })
                : []
              const imageSlotRecords = imageSlots.map((slot) => buildSlotRecord({ slot, uploadedAssets }))
              const mainRecord = imageSlotRecords[0]
              const heroUrl = mainRecord?.detailUrl || uploadedAssets.find((asset) => asset.kind === `${mainSlot.id}:hero`)?.url || ''
              const hasNewMainAssets = uploadedAssets.some((asset) => asset.kind.startsWith(`${mainSlot.id}:`))
              const includeAssetChanges = !slug || uploadedAssets.length > 0
              const includeImageSlotChanges = !slug || imageSlotsDirty || uploadedAssets.length > 0
              const payload = {
                name,
                headline,
                summary: derivedSummary,
                tags: splitCommaValues(tags),
                visibility,
                sourceType,
                sourceUrl: sourceType === 'derivative' ? sourceUrl.trim() : '',
                rightsConfirmed,
                creatorName,
                ...(!slug || hasNewMainAssets ? { coverImageUrl: heroUrl } : {}),
                worldRulesMarkdown: worldPrompt,
                ...(includeAssetChanges ? { assets: uploadedAssets } : {}),
                promptProfileJson: {
                  masterPrompt: worldPrompt.trim(),
                  worldIntro: worldIntro.trim(),
                  rules: worldPrompt.trim() ? [worldPrompt.trim()] : [],
                  tone: headline.trim() || derivedSummary,
                  starterLocations: [],
                  worldTerms: splitCommaValues(tags),
                  ...(includeImageSlotChanges ? { imageSlots: imageSlotRecords } : {}),
                  creatorName,
                },
              }
              const { item } = slug
                ? await platformApi.updateWorld(slug, payload)
                : await platformApi.createWorld(payload)
              toast.success(slug ? '월드를 수정했습니다.' : '월드를 만들었습니다.')
              finishAndNavigate(`/worlds/${item.slug}`, navigationSnapshot)
            })().catch((error) => toast.error(safeActionError(error, `월드를 ${slug ? '수정' : '저장'}하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.`))).finally(() => { isSavingRef.current = false; setIsSaving(false) })
          }}>{isSaving || isHydrating || isProcessingImages ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}{isHydrating ? '불러오는 중…' : isProcessingImages ? '이미지 처리 중…' : isSaving ? '저장 중…' : slug ? '월드 수정' : '월드 저장'}</Button>
        </div>
      </fieldset>
    </PageFrame>
  )
}

// 개인 기록 화면은 재진입이 잦은 데이터만 빠르게 보여주도록 분리한다.
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
                  <span className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${room.world ? 'bg-[#eef5ff] text-[#335a82]' : 'bg-[#f4f1f8] text-[#624c78]'}`}>{room.world ? '월드 포함' : '캐릭터 대화'}</span>
                  <span className="text-xs text-[#777]">{room.character.name}{room.world ? ` · ${room.world.name}` : ''}</span>
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

// 운영 화면은 owner 전용 노출 제어와 홈 배너 제어만 다룬다.
export function OpsPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [dashboard, setDashboard] = useState<OwnerOpsDashboard | null>(null)
  const [reports, setReports] = useState<ContentReport[]>([])
  const [isForbidden, setIsForbidden] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ entityType: 'character' | 'world'; id: string; name: string } | null>(null)

  const loadDashboard = () => {
    setLoadError('')
    void Promise.all([platformApi.fetchOpsDashboard(), platformApi.fetchReports('open')])
      .then(([data, reportPayload]) => {
        if (!data) {
          setDashboard(null)
          setReports([])
          setIsForbidden(false)
          setLoadError('현재 운영 상태를 확인하지 못했습니다. 다시 불러와 주세요.')
          return
        }
        setDashboard(data)
        setReports(reportPayload.reports)
        setIsForbidden(false)
      })
      .catch((error) => {
        if (error instanceof PlatformApiError && error.status === 403) {
          setIsForbidden(true)
          return
        }
        setLoadError('운영 데이터를 불러오지 못했습니다. 다시 시도해 주세요.')
      })
  }

  const reviewReport = (reportId: string, action: 'dismiss' | 'restore' | 'quarantine' | 'remove') => {
    void platformApi.applyReportAction(reportId, action)
      .then(loadDashboard)
      .catch((error) => toast.error(safeActionError(error, '신고 상태를 변경하지 못했습니다. 현재 상태는 유지됩니다. 다시 시도해 주세요.')))
  }

  useEffect(() => {
    if (!chrome.user) return
    loadDashboard()
  }, [chrome.user])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인이 필요합니다" description="운영자 계정으로 로그인해 주세요." />
  }

  if (isForbidden) {
    return (
      <PageFrame chrome={chrome} showCombinationDock={false}>
        <EmptyState title="운영 권한이 없습니다" description="운영자 계정으로 로그인해 주세요." />
      </PageFrame>
    )
  }

  return (
    <PageFrame chrome={chrome} showCombinationDock={false}>
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <DialogContent className="max-w-lg rounded-xl bg-white text-[#171717]">
          <DialogHeader>
            <DialogTitle className="text-[#171717]">{pendingDelete?.name} 삭제</DialogTitle>
            <DialogDescription className="text-[#737373]">삭제하면 연결된 자산과 관련 방이 함께 사라질 수 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-[#ff5148]/30 bg-[#ff5148]/10 px-4 py-4 text-sm text-[#4d4d4d]">
            {pendingDelete?.name}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>취소</Button>
            <Button className="bg-[#d43a34] text-white hover:bg-[#c9342f]" onClick={() => {
              if (!pendingDelete) return
              void platformApi.deleteContent(pendingDelete.entityType, pendingDelete.id)
                .then(() => {
                  toast.success('삭제했습니다.')
                  setPendingDelete(null)
                  loadDashboard()
                })
                .catch((error) => toast.error(safeActionError(error, '콘텐츠 삭제 결과를 확인하지 못했습니다. 목록을 다시 불러와 현재 상태를 확인해 주세요.')))
            }}>
              <Trash2 className="h-4 w-4" />삭제
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {!dashboard ? (
        loadError ? <EmptyState title="운영 데이터를 불러오지 못했습니다" description={loadError} action={<Button onClick={loadDashboard}>다시 불러오기</Button>} /> : <LoadingState label="운영 데이터 불러오는 중…" />
      ) : (
        <div className="space-y-6">
          <PageSection title={`신고 큐 ${reports.length ? `(${reports.length})` : ''}`}>
            {reports.length === 0 ? <EmptyState title="검토할 신고가 없습니다" description="새 신고가 들어오면 콘텐츠와 사유가 여기에 표시됩니다." /> : <div className="space-y-3">{reports.map((report) => <div key={report.id} className="rounded-lg border border-[#e7e7e7] bg-[#ffffff] p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="font-bold text-[#171717]">{report.entityName}</p><p className="mt-1 text-xs font-semibold text-[#c9342f]">{report.entityType === 'character' ? '캐릭터' : '월드'} · {report.reason}</p>{report.details ? <p className="mt-2 break-words text-sm text-[#666666]">{report.details}</p> : null}</div><div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap"><Button size="sm" variant="outline" onClick={() => reviewReport(report.id, 'dismiss')}>기각</Button><Button size="sm" variant="outline" onClick={() => reviewReport(report.id, 'restore')}>복구</Button><Button size="sm" className="bg-[#d43a34] text-white hover:bg-[#c9342f]" onClick={() => reviewReport(report.id, 'quarantine')}>격리</Button><Button size="sm" variant="destructive" onClick={() => reviewReport(report.id, 'remove')}>차단</Button></div></div></div>)}</div>}
          </PageSection>
          <PageSection title="콘텐츠 관리">
            <div className="space-y-4">
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-[#171717]">캐릭터 운영</h3>
                  {[{ title: '노출 중', items: dashboard.items.visibleCharacters, entityType: 'character' as const, visible: true }, { title: '숨김', items: dashboard.items.hiddenCharacters, entityType: 'character' as const, visible: false }].map((section) => (
                    <div key={section.title} className="space-y-3 rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                      <p className="text-sm font-semibold text-[#171717]">{section.title}</p>
                      <div className="grid gap-3">
                        {section.items.map((item) => (
                          <div key={item.id} className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-semibold text-[#171717]">{item.name}</p>
                                <p className="mt-2 break-words text-sm text-[#737373]">{item.summary}</p>
                              </div>
                              <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                                <Button variant="outline" className={`${section.visible ? 'border-[#d8d8d8] text-[#555] hover:bg-[#f5f5f5]' : 'border-[#b9d8c5] text-[#28643f] hover:bg-[#eef8f1]'} flex-1 sm:flex-none`} onClick={() => {
                                  const action = section.visible ? platformApi.hideContent : platformApi.showContent
                                  const verb = section.visible ? '숨김' : '복구'
                                  void action('character', item.id)
                                    .then(() => {
                                      toast.success(`${verb} 처리했습니다.`)
                                      loadDashboard()
                                    })
                                    .catch((error) => toast.error(safeActionError(error, `${verb} 처리하지 못했습니다. 현재 상태는 유지됩니다. 다시 시도해 주세요.`)))
                                }}>
                                  {section.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{section.visible ? '숨김' : '복구'}
                                </Button>
                                <Button variant="outline" className="flex-1 border-[#ff5148]/40 text-[#c9342f] hover:bg-[#ff5148]/10 hover:text-[#171717] sm:flex-none" onClick={() => setPendingDelete({ entityType: 'character', id: item.id, name: item.name })}>
                                  <Trash2 className="h-4 w-4" />삭제
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-[#171717]">월드 운영</h3>
                  {[{ title: '노출 중', items: dashboard.items.visibleWorlds, entityType: 'world' as const, visible: true }, { title: '숨김', items: dashboard.items.hiddenWorlds, entityType: 'world' as const, visible: false }].map((section) => (
                    <div key={section.title} className="space-y-3 rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                      <p className="text-sm font-semibold text-[#171717]">{section.title}</p>
                      <div className="grid gap-3">
                        {section.items.map((item) => (
                          <div key={item.id} className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-semibold text-[#171717]">{item.name}</p>
                                <p className="mt-2 break-words text-sm text-[#737373]">{item.summary}</p>
                              </div>
                              <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                                <Button variant="outline" className={`${section.visible ? 'border-[#d8d8d8] text-[#555] hover:bg-[#f5f5f5]' : 'border-[#b9d8c5] text-[#28643f] hover:bg-[#eef8f1]'} flex-1 sm:flex-none`} onClick={() => {
                                  const action = section.visible ? platformApi.hideContent : platformApi.showContent
                                  const verb = section.visible ? '숨김' : '복구'
                                  void action('world', item.id)
                                    .then(() => {
                                      toast.success(`${verb} 처리했습니다.`)
                                      loadDashboard()
                                    })
                                    .catch((error) => toast.error(safeActionError(error, `${verb} 처리하지 못했습니다. 현재 상태는 유지됩니다. 다시 시도해 주세요.`)))
                                }}>
                                  {section.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{section.visible ? '숨김' : '복구'}
                                </Button>
                                <Button variant="outline" className="flex-1 border-[#ff5148]/40 text-[#c9342f] hover:bg-[#ff5148]/10 hover:text-[#171717] sm:flex-none" onClick={() => setPendingDelete({ entityType: 'world', id: item.id, name: item.name })}>
                                  <Trash2 className="h-4 w-4" />삭제
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
            </div>
          </PageSection>
        </div>
      )}
    </PageFrame>
  )
}
