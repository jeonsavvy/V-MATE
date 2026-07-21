import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookMarked, Eye, EyeOff, Flag, Image, ImagePlus, Loader2, MessageCircle, PlusCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CharacterDetail, CharacterSummary, ChatQuota, ContentReport, LibraryPayload, OwnerOpsDashboard, RoomSummary, WorldDetail, WorldSummary } from '@/lib/platform/types'
import { platformApi } from '@/lib/platform/apiClient'
import { CHARACTER_VARIANTS, createImageVariants, type ResizedImageAsset, WORLD_VARIANTS } from '@/lib/platform/imagePipeline'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ArtworkFrame, EmptyState, EntityCard, LinkCard, PageSection, PlatformShell } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

// 상세, 시작, 대화, 제작, 운영 화면을 한 파일에 두고 공통 흐름을 재사용한다.
const PageFrame = ({ chrome, children, showCombinationDock = true }: { chrome: PlatformPageChromeProps; children: ReactNode; showCombinationDock?: boolean }) => (
  <PlatformShell
    user={chrome.user}
    userAvatarInitial={chrome.userAvatarInitial}
    searchValue={chrome.searchQuery}
    onSearchChange={chrome.onSearchChange}
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
  >
    {children}
  </PlatformShell>
)

const ProtectedGate = ({ chrome, title, description }: { chrome: PlatformPageChromeProps; title: string; description: string }) => (
  <PageFrame chrome={chrome}>
    <EmptyState title={title} description={description} action={<Button onClick={chrome.onAuthRequest}>로그인</Button>} />
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
    <DialogContent className="max-w-3xl rounded-xl bg-white text-[#171717]">
      <DialogHeader>
        <DialogTitle className="text-[#171717]">{title}</DialogTitle>
        <DialogDescription className="text-[#737373]">{description}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 md:grid-cols-2">
        {emptyOption ? <LinkCard title={emptyOption.title} body={emptyOption.body} onClick={() => onSelect(null)} /> : null}
        {items.map((item) => (
          <LinkCard key={item.id} title={item.title} body={item.body} onClick={() => onSelect(item.value)} />
        ))}
      </div>
    </DialogContent>
  </Dialog>
)

const AliasDialog = ({
  open,
  initialValue,
  onConfirm,
}: {
  open: boolean
  initialValue: string
  onConfirm: (value: string) => void
}) => {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent className="max-w-lg rounded-xl bg-white text-[#171717]">
        <DialogHeader>
          <DialogTitle className="text-[#171717]">캐릭터가 알아야 하는 이름을 입력해주세요</DialogTitle>
          <DialogDescription className="text-[#737373]">설정된 이름으로 캐릭터가 당신을 부르게 됩니다.</DialogDescription>
        </DialogHeader>
        <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="이름" className="bg-[#ffffff] text-[#171717] placeholder:text-[#aaaaaa]" />
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onConfirm('나')}>건너뛰기</Button>
          <Button onClick={() => onConfirm(value.trim() || '나')}>새 대화 시작</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

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
        <Button className="bg-[#ff5148] text-white hover:bg-[#e94740]" onClick={onConfirm} disabled={isDeleting}>
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
      .catch((error) => toast.error(error instanceof Error ? error.message : '신고를 접수하지 못했습니다.'))
      .finally(() => setIsSubmitting(false))
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rounded-xl border-[#e7e7e7] bg-white sm:max-w-md"><DialogHeader><DialogTitle>{entityName} 신고</DialogTitle><DialogDescription>운영 정책 위반 사유를 선택해주세요. 같은 콘텐츠에 중복 신고할 수 없습니다.</DialogDescription></DialogHeader><select value={reason} onChange={(event) => setReason(event.target.value)} className="h-11 rounded-lg border border-[#d8d8d8] bg-white px-3 text-sm"><option value="sexual_content">노골적인 성적 콘텐츠</option><option value="minor_safety">미성년자 안전</option><option value="hate_or_harassment">혐오·괴롭힘</option><option value="copyright">저작권·권리 침해</option><option value="spam">스팸·기만</option><option value="other">기타</option></select><textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="검토에 필요한 내용을 적어주세요. (선택)" className="min-h-28 rounded-lg border border-[#d8d8d8] bg-white px-4 py-3 text-sm text-[#171717] outline-none placeholder:text-[#aaaaaa]" maxLength={1000} /><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button><Button onClick={submit} disabled={isSubmitting} className="bg-[#ff5148] text-white hover:bg-[#e94740]">{isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Flag className="size-4" />}신고 접수</Button></DialogFooter></DialogContent></Dialog>
}

// 상세 화면은 공개 조회와 새 방 진입을 함께 책임진다.
export function CharacterDetailPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  const [item, setItem] = useState<CharacterDetail | null>(null)
  const [availableWorlds, setAvailableWorlds] = useState<WorldSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorldSlug, setPendingWorldSlug] = useState<string | null | undefined>(undefined)
  const [aliasOpen, setAliasOpen] = useState(false)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    void Promise.all([platformApi.fetchCharacter(slug), platformApi.fetchWorlds('', 'popular')])
      .then(([character, worlds]) => {
        if (!mounted) return
        setItem(character.item)
        setAvailableWorlds(worlds.items)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [slug])

  useEffect(() => {
    if (!chrome.user || !item) {
      setIsBookmarked(false)
      return
    }

    let mounted = true
    void platformApi.addRecentView('character', item.slug).catch(() => undefined)
    void platformApi.fetchLibrary()
      .then((data) => {
        if (!mounted) return
        setIsBookmarked(data.bookmarks.some((entry) => entry.entityType === 'character' && entry.item.slug === item.slug))
      })
      .catch(() => undefined)

    return () => { mounted = false }
  }, [chrome.user, item])

  const startRoom = (worldSlug?: string | null, aliasOverride?: string) => {
    if (!item) return
    void platformApi.createRoom({ characterSlug: item.slug, worldSlug: worldSlug || null, userAlias: aliasOverride })
      .then(({ room }) => chrome.onNavigate(`/rooms/${room.id}`))
      .catch((error) => toast.error(error instanceof Error ? error.message : '새 대화 시작에 실패했습니다.'))
  }

  const handleStart = (selectedWorldSlug: string | null) => {
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }
    const displayName = String(chrome.user.user_metadata?.name || '').trim()
    if (!displayName) {
      setPendingWorldSlug(selectedWorldSlug)
      setAliasOpen(true)
      return
    }
    startRoom(selectedWorldSlug, displayName)
  }

  const handleBookmarkToggle = () => {
    if (!item) return
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }

    void platformApi.toggleBookmark('character', item.slug)
      .then(({ active }) => {
        setIsBookmarked(active)
        toast.success(active ? '즐겨찾기에 저장했습니다.' : '즐겨찾기를 해제했습니다.')
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '즐겨찾기 처리에 실패했습니다.'))
  }

  const worldPickerItems = availableWorlds.map((world) => ({
    id: world.id,
    title: world.name,
    body: world.headline || world.summary,
    value: world.slug,
  }))

  if (!item) {
    return <PageFrame chrome={chrome}><EmptyState title="캐릭터를 불러오는 중" description="잠시만 기다려주세요." /></PageFrame>
  }

  return (
    <PageFrame chrome={chrome}>
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} entityType="character" entityId={item.id} entityName={item.name} />
      <CharacterWorldPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="월드를 골라 새 대화를 시작하세요"
        description="원하는 월드를 고르면 캐릭터 결은 유지한 채 그 장면 안으로 바로 들어갑니다."
        emptyOption={{ title: '캐릭터 단독으로 시작', body: '월드 없이 캐릭터 자체의 결로 바로 대화를 시작합니다.' }}
        items={worldPickerItems}
        onSelect={(worldSlug) => { setPickerOpen(false); handleStart(worldSlug) }}
      />
      <AliasDialog open={aliasOpen} initialValue={String(chrome.user?.user_metadata?.name || '')} onConfirm={(value) => { setAliasOpen(false); startRoom(pendingWorldSlug ?? null, value) }} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)]">
        <ArtworkFrame src={item.avatarImageUrl || item.coverImageUrl} alt={item.name} aspectClassName="aspect-[4/5] xl:max-h-[720px]" className="mx-auto w-full max-w-[28rem] rounded-lg lg:mx-0 lg:max-w-none" priority />
        <div className="space-y-6 py-1 lg:pl-4">
          <div className="border-b border-[#e7e7e7] pb-5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8c8c8c]">캐릭터</p>
            <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.6rem)] font-semibold tracking-[-0.04em] text-[#171717]">{item.name}</h1>
            <p className="mt-3 text-base leading-8 text-[#666666]">{item.summary}</p>
            <p className="mt-4 text-xs font-semibold text-[#888888]">by {item.creator.name} · {item.sourceType === 'original' ? '오리지널' : '2차창작'}</p>
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
            <Button onClick={() => chrome.onSelectEntity(item)} className="bg-[#ff5148] text-white hover:bg-[#e94740]"><PlusCircle className="h-4 w-4" />이 캐릭터 선택</Button>
            <Button variant="outline" onClick={() => handleStart(null)}><MessageCircle className="h-4 w-4" />바로 대화</Button>
            <Button variant="outline" onClick={() => setPickerOpen(true)}>월드 선택 후 시작</Button>
            <Button variant="outline" onClick={handleBookmarkToggle}><BookMarked className="h-4 w-4" />{isBookmarked ? '즐겨찾기 해제' : '즐겨찾기 저장'}</Button>
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
  const [availableCharacters, setAvailableCharacters] = useState<CharacterSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [aliasOpen, setAliasOpen] = useState(false)
  const [pendingCharacter, setPendingCharacter] = useState<CharacterSummary | null>(null)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    void Promise.all([platformApi.fetchWorld(slug), platformApi.fetchCharacters('', 'popular')])
      .then(([world, characters]) => {
        if (!mounted) return
        setItem(world.item)
        setAvailableCharacters(characters.items)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '월드를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [slug])

  useEffect(() => {
    if (!chrome.user || !item) {
      setIsBookmarked(false)
      return
    }

    let mounted = true
    void platformApi.addRecentView('world', item.slug).catch(() => undefined)
    void platformApi.fetchLibrary()
      .then((data) => {
        if (!mounted) return
        setIsBookmarked(data.bookmarks.some((entry) => entry.entityType === 'world' && entry.item.slug === item.slug))
      })
      .catch(() => undefined)

    return () => { mounted = false }
  }, [chrome.user, item])

  const startRoom = (character: CharacterSummary, aliasOverride?: string) => {
    if (!item) return
    void platformApi.createRoom({ characterSlug: character.slug, worldSlug: item.slug, userAlias: aliasOverride })
      .then(({ room }) => chrome.onNavigate(`/rooms/${room.id}`))
      .catch((error) => toast.error(error instanceof Error ? error.message : '새 대화 시작에 실패했습니다.'))
  }

  const handleStart = (character: CharacterSummary) => {
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }
    const displayName = String(chrome.user.user_metadata?.name || '').trim()
    if (!displayName) {
      setPendingCharacter(character)
      setAliasOpen(true)
      return
    }
    startRoom(character, displayName)
  }

  const handleBookmarkToggle = () => {
    if (!item) return
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }

    void platformApi.toggleBookmark('world', item.slug)
      .then(({ active }) => {
        setIsBookmarked(active)
        toast.success(active ? '즐겨찾기에 저장했습니다.' : '즐겨찾기를 해제했습니다.')
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '즐겨찾기 처리에 실패했습니다.'))
  }

  if (!item) {
    return <PageFrame chrome={chrome}><EmptyState title="월드를 불러오는 중" description="잠시만 기다려주세요." /></PageFrame>
  }

  return (
    <PageFrame chrome={chrome}>
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} entityType="world" entityId={item.id} entityName={item.name} />
      <AliasDialog open={aliasOpen} initialValue={String(chrome.user?.user_metadata?.name || '')} onConfirm={(value) => { setAliasOpen(false); if (pendingCharacter) startRoom(pendingCharacter, value) }} />
      <CharacterWorldPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="캐릭터를 골라 이 월드에서 시작하세요"
        description="추천 캐릭터가 아니라, 지금 보이는 월드에 넣고 싶은 캐릭터를 직접 골라 시작합니다."
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
        <ArtworkFrame src={item.coverImageUrl} alt={item.name} aspectClassName="aspect-[16/9]" className="rounded-lg" priority />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
          <div className="space-y-6 py-1 lg:pr-6">
            <div className="border-b border-[#e7e7e7] pb-5">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8c8c8c]">월드</p>
              <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.4rem)] font-semibold tracking-[-0.04em] text-[#171717]">{item.name}</h1>
              <p className="mt-3 text-base leading-8 text-[#666666]">{item.summary}</p>
              <p className="mt-4 text-xs font-semibold text-[#888888]">by {item.creator.name} · {item.sourceType === 'original' ? '오리지널' : '2차창작'}</p>
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
              <Button onClick={() => chrome.onSelectEntity(item)} className="bg-[#ff5148] text-white hover:bg-[#e94740]"><PlusCircle className="h-4 w-4" />이 월드 선택</Button>
              <Button variant="outline" onClick={() => setPickerOpen(true)}><MessageCircle className="h-4 w-4" />캐릭터 선택 후 시작</Button>
              <Button variant="outline" onClick={handleBookmarkToggle}><BookMarked className="h-4 w-4" />{isBookmarked ? '즐겨찾기 해제' : '즐겨찾기 저장'}</Button>
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
    return <div className="flex justify-end"><p className="max-w-[84%] rounded-[14px_14px_3px_14px] bg-[#f1f1f1] px-4 py-3 text-sm leading-7 text-[#171717]">{message.content as string}</p></div>
  }
  const payload = message.content as Extract<RoomSummary['messages'][number]['content'], object>
  return (
    <div className="space-y-3 border-b border-[#eeeeee] py-4 last:border-b-0">
      {payload.narration ? <p className="text-sm italic leading-7 text-[#777]">{payload.narration}</p> : null}
      <p className="text-base leading-8 text-[#171717]">{payload.response}</p>
      {payload.inner_heart ? <details className="rounded-md bg-[#f7f7f7] px-3 py-2 text-sm text-[#666]"><summary className="cursor-pointer font-semibold text-[#555]">속마음 보기</summary><p className="mt-2 leading-6">{payload.inner_heart}</p></details> : null}
    </div>
  )
}

// 시작 URL은 상세 화면으로 정규화해 링크 형태만 다르고 핵심 경험은 하나로 유지한다.
export function StartCharacterPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  useEffect(() => {
    chrome.onNavigate(`/characters/${slug}`)
  }, [chrome, slug])
  return <PageFrame chrome={chrome}><EmptyState title="캐릭터 상세로 이동하는 중" description="잠시만 기다려주세요." /></PageFrame>
}

export function StartWorldPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  useEffect(() => {
    chrome.onNavigate(`/worlds/${slug}`)
  }, [chrome, slug])
  return <PageFrame chrome={chrome}><EmptyState title="월드 상세로 이동하는 중" description="잠시만 기다려주세요." /></PageFrame>
}

// 플레이 룸은 메시지, 상태 요약, 이미지 슬롯 반영을 같은 세션 모델로 묶는다.
export function RoomPage({ chrome, roomId }: { chrome: PlatformPageChromeProps; roomId: string }) {
  const [room, setRoom] = useState<RoomSummary | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [needsRetry, setNeedsRetry] = useState(false)
  const [quota, setQuota] = useState<ChatQuota | null>(null)
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null)

  useEffect(() => {
    if (!chrome.user) return
    let mounted = true
    void Promise.all([platformApi.fetchRoom(roomId), platformApi.fetchChatQuota()])
      .then(([{ room }, quotaPayload]) => { if (mounted) { setRoom(room); setQuota(quotaPayload.quota) } })
      .catch((error) => toast.error(error instanceof Error ? error.message : '대화를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [chrome.user, roomId])

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

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 대화를 이어갈 수 있습니다" description="캐릭터 단독 대화도, 월드 안에서의 대화도 로그인 후 저장됩니다." />
  }

  return (
    <PageFrame chrome={chrome} showCombinationDock={false}>
      {!room ? (
        <EmptyState title="대화를 불러오는 중" description="최근 장면과 상태를 정리하고 있습니다." />
      ) : (
        <div className="mx-auto max-w-[860px] space-y-6">
          <div className="flex items-start justify-between gap-4 border-b border-[#e7e7e7] pb-5">
              <div>
                <p className="text-[0.72rem] font-bold uppercase tracking-[0.18em] text-[#888]">CHAT ROOM</p>
                <h1 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[#171717]">{room.title}</h1>
                <p className="mt-1 text-sm text-[#777]">{room.userAlias} · {room.character.name}{room.world ? ` · ${room.world.name}` : ''}</p>
                {quota ? <p className="mt-2 text-xs font-bold text-[#ff5148]">오늘 남은 메시지 {quota.remaining}/{quota.limit} · {new Date(quota.resetAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 초기화</p> : null}
              </div>
              <Button variant="ghost" className="shrink-0 text-[#666]" onClick={() => chrome.onNavigate(room.world ? `/worlds/${room.world.slug}` : `/characters/${room.character.slug}`)}>
                <ArrowLeft className="h-4 w-4" />돌아가기
              </Button>
          </div>

          <div className="relative">
            {room.world ? (
              <>
                <ArtworkFrame src={activeWorldImage} alt={room.world.name} aspectClassName="aspect-[16/9]" className="rounded-lg" priority />
                <ArtworkFrame src={activeCharacterImage} alt={room.character.name} aspectClassName="aspect-[4/5]" className="absolute bottom-3 right-3 z-10 w-24 rounded-md border-[3px] border-white shadow-[0_16px_30px_-14px_rgba(0,0,0,0.45)] sm:w-32" priority />
              </>
            ) : (
              <ArtworkFrame src={activeCharacterImage} alt={room.character.name} aspectClassName="aspect-[4/5]" className="mx-auto w-full max-w-[34rem] rounded-lg" priority />
            )}
          </div>

          <section aria-label="대화 메시지" className="space-y-4 py-1">
              {room.messages.map((message) => <NarrativeMessage key={message.id} message={message} />)}
              {isLoading ? <div className="text-sm text-[#171717]/46"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />응답을 생성하는 중...</div> : null}
          </section>

          <div className="space-y-3 border-t border-[#e7e7e7] pt-5">
              <textarea value={input} onChange={(event) => {
                setInput(event.target.value)
                setPendingRequestId(null)
                if (needsRetry) {
                  setNeedsRetry(false)
                }
              }} placeholder="메시지를 입력하세요" className="min-h-[112px] w-full resize-y rounded-lg border border-[#dedede] bg-white px-4 py-3 text-[15px] leading-7 text-[#171717] outline-none transition placeholder:text-[#aaa] focus:border-[#999]" />
              {needsRetry ? (
                <div className="rounded-xl border border-[#ffcc88]/30 bg-[#ffcc88]/10 px-4 py-3 text-sm text-[#4d4d4d]">
                  일시적으로 응답이 비어 다시 시도가 필요합니다. 입력 내용은 유지되어 바로 다시 보낼 수 있습니다.
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[#888]">{quota?.remaining === 0 ? '오늘의 메시지를 모두 사용했습니다.' : 'Enter 대신 버튼을 눌러 전송합니다.'}</p>
                <Button className="bg-[#ff5148] text-white shadow-none hover:bg-[#e94740]" disabled={isLoading || !input.trim() || quota?.remaining === 0} onClick={() => {
                  if (!input.trim()) return
                  const requestId = pendingRequestId || crypto.randomUUID()
                  setPendingRequestId(requestId)
                  setNeedsRetry(false)
                  setIsLoading(true)
                  void platformApi.sendRoomMessage(room.id, input.trim(), requestId)
                    .then((payload) => {
                      setRoom(payload.room)
                      setQuota(payload.quota)
                      setInput('')
                      setPendingRequestId(null)
                      setNeedsRetry(false)
                    })
                    .catch((error) => {
                      const typedError = error as Error & { code?: string; details?: { quota?: ChatQuota } }
                      const message = error instanceof Error ? error.message : '메시지 전송에 실패했습니다.'
                      // 서버 오류 응답은 사용량이 환불되므로 재시도 시 새 예약 ID를 사용한다.
                      // 네트워크 단절처럼 응답 자체가 없으면 같은 ID를 유지해 중복 차감을 막는다.
                      if (typedError.code && typedError.code !== 'CHAT_REQUEST_IN_PROGRESS') setPendingRequestId(null)
                      if (typedError.code === 'CHAT_REQUEST_IN_PROGRESS') {
                        if (typedError.details?.quota) setQuota(typedError.details.quota)
                        setNeedsRetry(true)
                        toast.error('같은 메시지를 처리하고 있습니다. 잠시 후 다시 시도해주세요.')
                        return
                      }
                      if (typedError.code === 'CHAT_DAILY_LIMIT_EXCEEDED') {
                        if (typedError.details?.quota) setQuota(typedError.details.quota)
                        toast.error('오늘의 무료 메시지를 모두 사용했습니다.')
                        return
                      }
                      if (message.includes('Gemini returned an empty response')) {
                        setNeedsRetry(true)
                        toast.error('응답이 비어 다시 시도할 수 있습니다. 입력 내용은 유지됩니다.')
                        return
                      }
                      toast.error(message)
                    })
                    .finally(() => setIsLoading(false))
                }}>{needsRetry ? '다시 시도' : '보내기'}</Button>
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
        <label
          htmlFor={inputId}
          className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold tracking-[-0.015em] transition ${
            isProcessing ? 'pointer-events-none bg-[#f3f3f3] text-[#171717]/48' : 'bg-white text-[#111317] hover:bg-white/92'
          }`}
        >
          <ImagePlus className="h-4 w-4" />
          {isProcessing ? '이미지 처리 중...' : actionLabel}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            onChange(file)
          }}
        />
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
  id: slot.id || createSlotId(),
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
      .uploadToSignedUrl(target.path, target.token, blob, { contentType: 'image/webp', upsert: true })
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
  <div className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4 text-sm leading-6 text-[#626262]">
    <p className="font-semibold text-[#171717]">{title}</p>
    <ul className="mt-3 space-y-2">
      {bullets.map((bullet) => <li key={bullet}>• {bullet}</li>)}
    </ul>
  </div>
)

const SituationImageSlotsEditor = ({
  sectionTitle,
  mainDescription,
  aspectClassName,
  slots,
  processingSlotId,
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
  processingSlotId: string | null
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
        title="대표 이미지"
        description={mainDescription}
        previewUrl={mainSlot.previewUrl}
        previewAlt={`${sectionTitle} 대표 이미지 미리보기`}
        aspectClassName={aspectClassName}
        hint={`현재 원본 ${mainSlot.sourceSize || '미선택'} · AI가 상황에 따라 추가 이미지로 전환할 수 있습니다.`}
        isProcessing={processingSlotId === mainSlot.id}
        onChange={(file) => onUpload(mainSlot.id, file)}
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#171717]">상황별 이미지 추가</p>
          <p className="mt-1 text-sm leading-6 text-[#737373]">장면이 바뀔 때 어떤 이미지로 전환할지 슬롯별로 지정합니다.</p>
        </div>
        <Button variant="outline" onClick={onAdd}>
          <ImagePlus className="h-4 w-4" />상황별 이미지 추가
        </Button>
      </div>

      {slots.slice(1).map((slot) => (
        <div key={slot.id} className="grid gap-4 rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-3">
            <ArtworkFrame src={slot.previewUrl} alt={`${slot.slot || '상황별'} 이미지 미리보기`} aspectClassName={aspectClassName} />
            <label className={`inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold tracking-[-0.015em] transition ${processingSlotId === slot.id ? 'pointer-events-none bg-[#f3f3f3] text-[#171717]/48' : 'bg-white text-[#111317] hover:bg-white/92'}`}>
              <ImagePlus className="h-4 w-4" />{processingSlotId === slot.id ? '이미지 처리 중...' : '이미지 선택'}
              <input
                id={`${inputPrefix}-${slot.id}-image-upload-input`}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.currentTarget.value = ''
                  if (!file) return
                  onUpload(slot.id, file)
                }}
              />
            </label>
            <p className="text-xs leading-6 text-[#7a7a7a]">현재 원본 {slot.sourceSize || '미선택'} · 이 슬롯에 이미지를 올려야 AI가 선택할 수 있습니다.</p>
          </div>

          <div className="grid min-w-0 gap-4">
            <Input
              value={slot.slot}
              onChange={(event) => onUpdate(slot.id, { slot: event.target.value, usage: event.target.value })}
              placeholder="이미지 이름 (예: battle, rain, night)"
              className="bg-[#ffffff] text-[#171717] placeholder:text-[#aaaaaa]"
            />
            <textarea
              value={slot.trigger}
              onChange={(event) => onUpdate(slot.id, { trigger: event.target.value })}
              placeholder="언제 이 이미지를 써야 하는지 아주 구체적으로 적어주세요. 예) 말싸움이 격해지거나 긴장감이 급상승할 때"
              className="min-h-[140px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-3 text-sm text-[#171717] outline-none placeholder:text-[#aaaaaa]"
            />
            <div className="flex justify-end">
              <Button variant="outline" className="border-[#ff5148]/40 text-[#ff5148] hover:bg-[#ff5148]/10 hover:text-[#171717]" onClick={() => onRemove(slot.id)}>
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
    <div><p className="text-xs font-bold text-[#ff5148]">CREATE</p><h1 className="mt-1 text-3xl font-black tracking-[-0.05em] text-[#171717]">{active === 'character' ? '캐릭터 만들기' : '월드 만들기'}</h1></div>
    <div className="flex rounded-lg border border-[#d8d8d8] bg-white p-1"><button type="button" onClick={() => onNavigate('/create/character')} className={`rounded-md px-3 py-2 text-xs font-bold ${active === 'character' ? 'bg-[#ff5148] text-white' : 'text-[#666666]'}`}>캐릭터</button><button type="button" onClick={() => onNavigate('/create/world')} className={`rounded-md px-3 py-2 text-xs font-bold ${active === 'world' ? 'bg-[#ff5148] text-white' : 'text-[#666666]'}`}>월드</button></div>
  </div>
)

const PublishingAttestation = ({ rightsConfirmed, onRightsChange }: { rightsConfirmed: boolean; onRightsChange: (value: boolean) => void }) => (
  <div className="space-y-3 rounded-lg border border-[#e7e7e7] bg-[#fff7f6] p-4 text-sm text-[#5f5551]">
    <p className="font-bold text-[#ff5148]">공개 전 확인</p>
    <label className="flex items-start gap-3"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => onRightsChange(event.target.checked)} className="mt-0.5 size-4 accent-[#ff5148]" /><span>이 콘텐츠와 업로드 이미지의 공개 권리를 보유하고 있습니다.</span></label>
  </div>
)

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
  const [processingSlotId, setProcessingSlotId] = useState<string | null>(null)
  const [isHydrating, setIsHydrating] = useState(Boolean(slug))
  const [canManage, setCanManage] = useState<boolean | null>(slug ? null : true)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [imageSlots, setImageSlots] = useState<ImageSlotDraft[]>(() => [
    createImageSlotDraft('main', '대표 이미지', '기본 대표 비주얼', '100'),
  ])

  const updateSlot = (slotId: string, patch: Partial<ImageSlotDraft>) => {
    setImageSlots((prev) => prev.map((slot) => slot.id === slotId ? { ...slot, ...patch } : slot))
  }

  const handleSlotUpload = (slotId: string, file: File) => {
    setProcessingSlotId(slotId)
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
      .catch((error) => toast.error(error instanceof Error ? error.message : '이미지 처리에 실패했습니다.'))
      .finally(() => setProcessingSlotId(null))
  }

  const mainSlot = imageSlots[0]!
  const creatorName = String(chrome.user?.user_metadata?.name || chrome.user?.email || '').trim()

  useEffect(() => {
    if (!slug) return
    let mounted = true
    setIsHydrating(true)
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
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터 정보를 불러오지 못했습니다.'))
      .finally(() => { if (mounted) setIsHydrating(false) })
    return () => { mounted = false }
  }, [slug])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 캐릭터를 만들 수 있습니다" description="만든 캐릭터는 바로 홈/상세/최근 대화 흐름에 연결됩니다." />
  }

  if (slug && canManage === false) {
    return (
      <PageFrame chrome={chrome}>
        <EmptyState
          title="본인 캐릭터만 수정하거나 삭제할 수 있습니다"
          description="캐릭터 상세 화면으로 돌아가 다시 확인해주세요."
          action={<Button onClick={() => chrome.onNavigate(`/characters/${slug}`)}>상세로 돌아가기</Button>}
        />
      </PageFrame>
    )
  }

  const derivedSummary = deriveSummaryFromPrompt(headline, characterPrompt)

  return (
    <PageFrame chrome={chrome} showCombinationDock={false}>
      <OwnedContentDeleteDialog
        open={pendingDelete}
        title="캐릭터를 삭제할까요?"
        description="삭제하면 연결된 이미지와 관련 데이터가 함께 정리됩니다."
        itemName={name || '이 캐릭터'}
        isDeleting={isDeleting}
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => {
          if (!slug) return
          setIsDeleting(true)
          void platformApi.deleteCharacter(slug)
            .then(() => {
              toast.success('캐릭터를 삭제했습니다.')
              chrome.onNavigate('/library')
            })
            .catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터 삭제에 실패했습니다.'))
            .finally(() => {
              setIsDeleting(false)
              setPendingDelete(false)
            })
        }}
      />
      <div className="mx-auto max-w-4xl space-y-6">
        <CreateTypeTabs active="character" onNavigate={chrome.onNavigate} />
        <PageSection title="기본 정보">
          <div className="grid gap-4">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="캐릭터 이름" className="bg-[#ffffff] text-[#171717] placeholder:text-[#aaaaaa]" />
            <Input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="한 줄 소개" className="bg-[#ffffff] text-[#171717] placeholder:text-[#aaaaaa]" />
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="태그 (쉼표로 구분)" className="bg-[#ffffff] text-[#171717] placeholder:text-[#aaaaaa]" />
            <label className="space-y-2 text-sm text-[#666666]">
              <span>공개 범위</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 text-[#171717] outline-none" style={selectStyle}>
                <option value="private">비공개로 저장</option><option value="public">전체 공개</option>
              </select>
            </label>
            <label className="space-y-2 text-sm text-[#666666]">
              <span>원작 여부</span>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 text-[#171717] outline-none" style={selectStyle}>
                <option value="original">오리지널</option><option value="derivative">2차창작</option>
              </select>
            </label>
            {sourceType === 'derivative' ? <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="원작 또는 출처 URL" /> : null}
            {visibility === 'public' ? <PublishingAttestation rightsConfirmed={rightsConfirmed} onRightsChange={setRightsConfirmed} /> : null}
          </div>
        </PageSection>

        <PageSection title="캐릭터 프롬프트">
          <div className="space-y-4">
            <PromptGuide
              title="이 프롬프트에 꼭 들어가야 할 것"
              bullets={[
                '캐릭터의 핵심 정체성: 누구인지, 왜 매력적인지, 사용자가 왜 붙게 되는지.',
                '말투 규칙: 존댓말/반말, 문장 길이, 자주 쓰는 어휘, 금지해야 할 어휘.',
                '관계 시작점: 처음 만났을 때 거리감, 경계심, 호감도, 주도권.',
                '행동 규칙: 갈등 시 반응, 다정함 표현 방식, 질투/당황/분노 시 변화.',
                '금지 규칙: 절대 깨지면 안 되는 설정, 말버릇, 세계관 위반 요소.',
                '이미지 전환 힌트: 어떤 장면이면 어떤 상황별 이미지 슬롯을 써야 하는지 같이 적기.',
              ]}
            />
            <textarea
              value={characterPrompt}
              onChange={(event) => setCharacterPrompt(event.target.value)}
              placeholder={[
                '예시 구조',
                '1) 캐릭터 정체성: 무심한 척하지만 실제로는 상대를 세심하게 챙기는 인물.',
                '2) 말투: 짧은 문장, 반말, 감정이 올라가면 더 직설적이지만 과하게 거칠어지지 않는다.',
                '3) 관계 시작: 처음에는 조금 거리를 두지만 사용자가 솔직하면 빠르게 가까워진다.',
                '4) 갈등/감정: 질투나 긴장 상황에서는 차갑게 굳지만 완전히 밀어내지는 않는다.',
                '5) 금지: 과장된 밈 말투 금지, 갑자기 다른 인격처럼 붕괴 금지.',
                '6) 이미지 전환: 대치/긴장 장면이면 battle 슬롯, 편안하고 가까운 장면이면 cozy 슬롯 사용.',
              ].join('\n')}
              className="min-h-[360px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-4 text-[15px] leading-7 text-[#171717] outline-none placeholder:text-[#aaaaaa]"
            />
          </div>
        </PageSection>

        <PageSection title="캐릭터 도입부">
          <div className="space-y-3">
            <p className="text-sm leading-6 text-[#6f6f6f]">처음 방을 열었을 때 캐릭터가 어떤 태도와 온도로 등장해야 하는지 짧고 명확하게 적어주세요.</p>
            <textarea
              value={characterIntro}
              onChange={(event) => setCharacterIntro(event.target.value)}
              placeholder="예) 사용자를 한 번 살핀 뒤 짧게 먼저 말을 건다. 경계는 있지만 무례하지 않고, 호기심이 먼저 보인다."
              className="min-h-[120px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-4 text-[15px] leading-7 text-[#171717] outline-none placeholder:text-[#aaaaaa]"
            />
          </div>
        </PageSection>

        <PageSection title="캐릭터 이미지">
          <div className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-3 text-sm text-[#626262]">
            권장 3:4 · 최소 768×1024 · JPG/PNG/WebP 업로드 가능 · 서비스 저장용 이미지는 자동으로 WebP 변환됩니다.
          </div>
          <SituationImageSlotsEditor
            sectionTitle={name || '캐릭터'}
            mainDescription="대표 이미지는 기본 표정/기본 상태입니다. 아래에 상황별 이미지를 추가하면 AI가 현재 장면을 보고 전환할 수 있습니다."
            aspectClassName="aspect-[3/4]"
            slots={imageSlots}
            processingSlotId={processingSlotId}
            inputPrefix="character"
            onUpload={handleSlotUpload}
            onAdd={() => setImageSlots((prev) => [...prev, createImageSlotDraft(`scene-${prev.length}`, `scene-${prev.length}`, '', String(Math.max(10, 100 - prev.length * 10)))])}
            onUpdate={updateSlot}
            onRemove={(slotId) => setImageSlots((prev) => prev.filter((slot) => slot.id !== slotId))}
          />
        </PageSection>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {slug ? (
            <Button variant="outline" className="border-[#ff5148]/40 text-[#ff5148] hover:bg-[#ff5148]/10 hover:text-[#171717]" onClick={() => setPendingDelete(true)} disabled={isHydrating || processingSlotId !== null || isDeleting || canManage !== true}>
              <Trash2 className="h-4 w-4" />캐릭터 삭제
            </Button>
          ) : <span />}
          <Button disabled={isHydrating || processingSlotId !== null || !name.trim() || !headline.trim() || !characterPrompt.trim() || !mainSlot.previewUrl || (visibility === 'public' && !rightsConfirmed)} onClick={() => {
            void (async () => {
              const slotAssets = imageSlots.flatMap((slot) => slot.assets)
              const uploadedAssets = slotAssets.length > 0
                ? await uploadPreparedAssets({ entityType: 'character', assets: slotAssets })
                : []
              const imageSlotRecords = imageSlots.map((slot) => buildSlotRecord({ slot, uploadedAssets }))
              const mainRecord = imageSlotRecords[0]
              const mainAssets = uploadedAssets
                .filter((asset) => asset.kind.startsWith(`${mainSlot.id}:`))
                .map((asset) => ({
                  kind: asset.kind.split(':')[1] || 'detail',
                  url: asset.url,
                  width: asset.width,
                  height: asset.height,
                }))
              const detailUrl = mainRecord?.detailUrl || ''
              const cardUrl = mainRecord?.cardUrl || detailUrl
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
                coverImageUrl: detailUrl,
                avatarImageUrl: cardUrl,
                assets: mainAssets,
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
                  imageSlots: imageSlotRecords,
                  creatorName,
                },
              }
              const { item } = slug
                ? await platformApi.updateCharacter(slug, payload)
                : await platformApi.createCharacter(payload)
              toast.success(slug ? '캐릭터를 수정했습니다.' : '캐릭터를 만들었습니다.')
              chrome.onNavigate(`/characters/${item.slug}`)
            })().catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터 생성에 실패했습니다.'))
          }}><PlusCircle className="h-4 w-4" />{isHydrating ? '불러오는 중...' : processingSlotId ? '이미지 처리 중...' : slug ? '캐릭터 수정' : '캐릭터 저장'}</Button>
        </div>
      </div>
    </PageFrame>
  )
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
  const [processingSlotId, setProcessingSlotId] = useState<string | null>(null)
  const [isHydrating, setIsHydrating] = useState(Boolean(slug))
  const [canManage, setCanManage] = useState<boolean | null>(slug ? null : true)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [imageSlots, setImageSlots] = useState<ImageSlotDraft[]>(() => [
    createImageSlotDraft('main', '대표 이미지', '기본 월드 비주얼', '100'),
  ])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 월드를 만들 수 있습니다" description="만든 월드는 캐릭터와 연결해 바로 새 대화를 시작할 수 있습니다." />
  }

  const updateSlot = (slotId: string, patch: Partial<ImageSlotDraft>) => {
    setImageSlots((prev) => prev.map((slot) => slot.id === slotId ? { ...slot, ...patch } : slot))
  }

  const handleSlotUpload = (slotId: string, file: File) => {
    setProcessingSlotId(slotId)
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
      .catch((error) => toast.error(error instanceof Error ? error.message : '이미지 처리에 실패했습니다.'))
      .finally(() => setProcessingSlotId(null))
  }

  const mainSlot = imageSlots[0]!
  const derivedSummary = deriveSummaryFromPrompt(headline, worldPrompt)
  const creatorName = String(chrome.user?.user_metadata?.name || chrome.user?.email || '').trim()

  useEffect(() => {
    if (!slug) return
    let mounted = true
    setIsHydrating(true)
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
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '월드 정보를 불러오지 못했습니다.'))
      .finally(() => { if (mounted) setIsHydrating(false) })
    return () => { mounted = false }
  }, [slug])

  if (slug && canManage === false) {
    return (
      <PageFrame chrome={chrome}>
        <EmptyState
          title="본인 월드만 수정하거나 삭제할 수 있습니다"
          description="월드 상세 화면으로 돌아가 다시 확인해주세요."
          action={<Button onClick={() => chrome.onNavigate(`/worlds/${slug}`)}>상세로 돌아가기</Button>}
        />
      </PageFrame>
    )
  }

  return (
    <PageFrame chrome={chrome} showCombinationDock={false}>
      <OwnedContentDeleteDialog
        open={pendingDelete}
        title="월드를 삭제할까요?"
        description="삭제하면 연결된 이미지와 관련 데이터가 함께 정리됩니다."
        itemName={name || '이 월드'}
        isDeleting={isDeleting}
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => {
          if (!slug) return
          setIsDeleting(true)
          void platformApi.deleteWorld(slug)
            .then(() => {
              toast.success('월드를 삭제했습니다.')
              chrome.onNavigate('/library')
            })
            .catch((error) => toast.error(error instanceof Error ? error.message : '월드 삭제에 실패했습니다.'))
            .finally(() => {
              setIsDeleting(false)
              setPendingDelete(false)
            })
        }}
      />
      <div className="mx-auto max-w-4xl space-y-6">
        <CreateTypeTabs active="world" onNavigate={chrome.onNavigate} />
        <PageSection title="기본 정보">
          <div className="grid gap-4">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="월드 이름" className="bg-[#ffffff] text-[#171717] placeholder:text-[#aaaaaa]" />
            <Input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="한 줄 설명" className="bg-[#ffffff] text-[#171717] placeholder:text-[#aaaaaa]" />
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="태그 (쉼표로 구분)" className="bg-[#ffffff] text-[#171717] placeholder:text-[#aaaaaa]" />
            <label className="space-y-2 text-sm text-[#666666]">
              <span>공개 범위</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 text-[#171717] outline-none" style={selectStyle}>
                <option value="private">비공개로 저장</option><option value="public">전체 공개</option>
              </select>
            </label>
            <label className="space-y-2 text-sm text-[#666666]">
              <span>원작 여부</span>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="h-11 w-full rounded-lg border border-[#d8d8d8] bg-white px-3 text-[#171717] outline-none" style={selectStyle}>
                <option value="original">오리지널</option><option value="derivative">2차창작</option>
              </select>
            </label>
            {sourceType === 'derivative' ? <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="원작 또는 출처 URL" /> : null}
            {visibility === 'public' ? <PublishingAttestation rightsConfirmed={rightsConfirmed} onRightsChange={setRightsConfirmed} /> : null}
          </div>
        </PageSection>

        <PageSection title="월드 프롬프트">
          <div className="space-y-4">
            <PromptGuide
              title="이 프롬프트에 꼭 들어가야 할 것"
              bullets={[
                '세계의 핵심 톤: 현실/판타지/게임 등 어떤 감도로 읽혀야 하는지.',
                '장면 규칙: 첫 진입 장면, 기본 압력, 긴장감, 사용자가 들어왔을 때 바로 벌어지는 일.',
                '공간/용어: 자주 등장하는 장소, 조직, 사물, 용어, 금지 전개.',
                '캐릭터 결합 규칙: 어떤 타입의 캐릭터가 와도 세계관이 안 깨지게 유지해야 하는 룰.',
                '이미지 전환 힌트: 비, 밤, 전투, 축제, 붕괴 직전 같은 장면 변화에 어떤 슬롯을 써야 하는지.',
              ]}
            />
            <textarea
              value={worldPrompt}
              onChange={(event) => setWorldPrompt(event.target.value)}
              placeholder={[
                '예시 구조',
                '1) 세계 톤: 비가 자주 오는 현실 도시, 심야의 눅눅함과 정적이 중요하다.',
                '2) 시작 장면: 사용자가 들어오면 편의점 앞/횡단보도/비 젖은 골목 중 한 곳에서 장면이 시작된다.',
                '3) 유지 규칙: 과장된 판타지 요소 금지, 현실적인 대사와 공간감 유지.',
                '4) 긴장 포인트: 늦은 밤, 막차, 비, 젖은 신발 소리, 짧은 침묵이 압력으로 작동한다.',
                '5) 금지: 갑자기 코미디 톤으로 붕괴 금지, 현실성 없는 초전개 금지.',
                '6) 이미지 전환: 비가 강해지면 rain 슬롯, 네온과 밤거리가 강조되면 neon-night 슬롯 사용.',
              ].join('\n')}
              className="min-h-[360px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-4 text-[15px] leading-7 text-[#171717] outline-none placeholder:text-[#aaaaaa]"
            />
          </div>
        </PageSection>

        <PageSection title="월드 도입부">
          <div className="space-y-3">
            <p className="text-sm leading-6 text-[#6f6f6f]">사용자가 이 월드에 들어왔을 때 기본적으로 어떤 장소, 어떤 압력, 어떤 장면으로 시작해야 하는지 간결하게 적어주세요.</p>
            <textarea
              value={worldIntro}
              onChange={(event) => setWorldIntro(event.target.value)}
              placeholder="예) 비가 막 그친 편의점 앞에서 시작한다. 막차가 얼마 남지 않아 시간이 촉박하고, 주변 공기는 조용하지만 눅눅한 긴장감이 있다."
              className="min-h-[120px] w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-4 text-[15px] leading-7 text-[#171717] outline-none placeholder:text-[#aaaaaa]"
            />
          </div>
        </PageSection>

        <PageSection title="월드 이미지">
          <div className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] px-4 py-3 text-sm text-[#626262]">
            권장 16:9 · 최소 1280×720 · JPG/PNG/WebP 업로드 가능 · 서비스 저장용 이미지는 자동으로 WebP 변환됩니다.
          </div>
          <SituationImageSlotsEditor
            sectionTitle={name || '월드'}
            mainDescription="대표 이미지는 기본 장면입니다. 아래에 비, 밤, 전투, 축제 같은 상황별 장면 이미지를 추가할 수 있습니다."
            aspectClassName="aspect-[16/9]"
            slots={imageSlots}
            processingSlotId={processingSlotId}
            inputPrefix="world"
            onUpload={handleSlotUpload}
            onAdd={() => setImageSlots((prev) => [...prev, createImageSlotDraft(`scene-${prev.length}`, `scene-${prev.length}`, '', String(Math.max(10, 100 - prev.length * 10)))])}
            onUpdate={updateSlot}
            onRemove={(slotId) => setImageSlots((prev) => prev.filter((slot) => slot.id !== slotId))}
          />
        </PageSection>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {slug ? (
            <Button variant="outline" className="border-[#ff5148]/40 text-[#ff5148] hover:bg-[#ff5148]/10 hover:text-[#171717]" onClick={() => setPendingDelete(true)} disabled={isHydrating || processingSlotId !== null || isDeleting || canManage !== true}>
              <Trash2 className="h-4 w-4" />월드 삭제
            </Button>
          ) : <span />}
          <Button disabled={isHydrating || processingSlotId !== null || !name.trim() || !headline.trim() || !worldPrompt.trim() || !mainSlot.previewUrl || (visibility === 'public' && !rightsConfirmed)} onClick={() => {
            void (async () => {
              const slotAssets = imageSlots.flatMap((slot) => slot.assets)
              const uploadedAssets = slotAssets.length > 0
                ? await uploadPreparedAssets({ entityType: 'world', assets: slotAssets })
                : []
              const imageSlotRecords = imageSlots.map((slot) => buildSlotRecord({ slot, uploadedAssets }))
              const mainRecord = imageSlotRecords[0]
              const heroUrl = mainRecord?.detailUrl || uploadedAssets.find((asset) => asset.kind === `${mainSlot.id}:hero`)?.url || ''
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
                coverImageUrl: heroUrl,
                worldRulesMarkdown: worldPrompt,
                assets: uploadedAssets,
                promptProfileJson: {
                  masterPrompt: worldPrompt.trim(),
                  worldIntro: worldIntro.trim(),
                  rules: worldPrompt.trim() ? [worldPrompt.trim()] : [],
                  tone: headline.trim() || derivedSummary,
                  starterLocations: [],
                  worldTerms: splitCommaValues(tags),
                  imageSlots: imageSlotRecords,
                  creatorName,
                },
              }
              const { item } = slug
                ? await platformApi.updateWorld(slug, payload)
                : await platformApi.createWorld(payload)
              toast.success(slug ? '월드를 수정했습니다.' : '월드를 만들었습니다.')
              chrome.onNavigate(`/worlds/${item.slug}`)
            })().catch((error) => toast.error(error instanceof Error ? error.message : '월드 생성에 실패했습니다.'))
          }}><PlusCircle className="h-4 w-4" />{isHydrating ? '불러오는 중...' : processingSlotId ? '이미지 처리 중...' : slug ? '월드 수정' : '월드 저장'}</Button>
        </div>
      </div>
    </PageFrame>
  )
}

// 개인 기록 화면은 재진입이 잦은 데이터만 빠르게 보여주도록 분리한다.
export function RecentRoomsPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [items, setItems] = useState<RoomSummary[]>([])

  useEffect(() => {
    if (!chrome.user) return
    let mounted = true
    void platformApi.fetchRecentRooms()
      .then(({ items }) => { if (mounted) setItems(items) })
      .catch((error) => toast.error(error instanceof Error ? error.message : '최근 대화를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [chrome.user])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 최근 대화를 볼 수 있습니다" description="캐릭터 단독 대화와 월드 안 대화를 한곳에서 관리합니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      <PageSection title="최근 대화">
        {items.length === 0 ? (
          <EmptyState title="아직 최근 대화가 없습니다" description="캐릭터나 월드 상세에서 새 대화를 시작해보세요." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((room) => (
              <button key={room.id} type="button" onClick={() => chrome.onNavigate(`/rooms/${room.id}`)} className="w-full rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4 text-left transition hover:border-white/18 hover:bg-white/7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${room.world ? 'bg-[#62d0ff]/15 text-[#9de7ff]' : 'bg-[#d98cff]/15 text-[#f0c4ff]'}`}>{room.world ? '월드 결합' : '직접 대화'}</span>
                  <span className="text-xs text-[#171717]/44">{room.character.name}{room.world ? ` · ${room.world.name}` : ''}</span>
                </div>
                <p className="mt-3 text-lg font-semibold text-[#171717]">{room.title}</p>
                <p className="mt-2 text-sm font-semibold text-[#171717]/70">마지막 장면</p>
                <p className="mt-1 text-sm leading-6 text-[#6f6f6f]">{room.state.currentSituation}</p>
              </button>
            ))}
          </div>
        )}
      </PageSection>
    </PageFrame>
  )
}

export function LibraryPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [library, setLibrary] = useState<LibraryPayload | null>(null)

  useEffect(() => {
    if (!chrome.user) return
    let mounted = true
    void platformApi.fetchLibrary()
      .then((data) => { if (mounted) setLibrary(data) })
      .catch((error) => toast.error(error instanceof Error ? error.message : '보관함을 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [chrome.user])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 보관함을 볼 수 있습니다" description="즐겨찾기와 최근 본 월드/캐릭터가 여기에 모입니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      {!library ? (
        <EmptyState title="보관함을 불러오는 중" description="잠시만 기다려주세요." />
      ) : (
        <div className="space-y-6">
          <PageSection title="즐겨찾기">
            {library.bookmarks.length === 0 ? <EmptyState title="아직 즐겨찾기가 없습니다" description="마음에 드는 캐릭터나 월드를 저장해보세요." /> : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {library.bookmarks.map((entry) => <EntityCard key={entry.id} item={entry.item} onClick={() => chrome.onNavigate(entry.entityType === 'character' ? `/characters/${entry.item.slug}` : `/worlds/${entry.item.slug}`)} />)}
              </div>
            )}
          </PageSection>

          <PageSection title="최근 본 항목">
            {library.recentViews.length === 0 ? <EmptyState title="아직 최근 본 항목이 없습니다" description="상세 페이지를 둘러보면 여기에 쌓입니다." /> : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {library.recentViews.map((entry) => <EntityCard key={entry.id} item={entry.item} onClick={() => chrome.onNavigate(entry.entityType === 'character' ? `/characters/${entry.item.slug}` : `/worlds/${entry.item.slug}`)} />)}
              </div>
            )}
          </PageSection>

          <PageSection title="내가 만든 캐릭터">
            {library.owned.characters.length === 0 ? <EmptyState title="아직 만든 캐릭터가 없습니다" description="캐릭터 만들기에서 첫 캐릭터를 등록해보세요." /> : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {library.owned.characters.map((item) => <EntityCard key={item.id} item={item} onClick={() => chrome.onNavigate(`/characters/${item.slug}`)} />)}
              </div>
            )}
          </PageSection>

          <PageSection title="내가 만든 월드">
            {library.owned.worlds.length === 0 ? <EmptyState title="아직 만든 월드가 없습니다" description="월드 만들기에서 첫 월드를 등록해보세요." /> : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {library.owned.worlds.map((item) => <EntityCard key={item.id} item={item} onClick={() => chrome.onNavigate(`/worlds/${item.slug}`)} />)}
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
  const [pendingDelete, setPendingDelete] = useState<{ entityType: 'character' | 'world'; id: string; name: string } | null>(null)

  const loadDashboard = () => {
    void Promise.all([platformApi.fetchOpsDashboard(), platformApi.fetchReports('open')])
      .then(([data, reportPayload]) => {
        setDashboard(data)
        setReports(reportPayload.reports)
        setIsForbidden(false)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '운영실 데이터를 불러오지 못했습니다.'
        if (message.includes('Owner access required')) {
          setIsForbidden(true)
          return
        }
        toast.error(message)
      })
  }

  const reviewReport = (reportId: string, action: 'dismiss' | 'restore' | 'quarantine' | 'remove') => {
    void platformApi.applyReportAction(reportId, action)
      .then(loadDashboard)
      .catch((error) => toast.error(error instanceof Error ? error.message : '신고 처리에 실패했습니다.'))
  }

  useEffect(() => {
    if (!chrome.user) return
    loadDashboard()
  }, [chrome.user])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 운영실에 접근할 수 있습니다" description="운영자 권한이 있는 계정만 접근 가능합니다." />
  }

  if (isForbidden) {
    return (
      <PageFrame chrome={chrome} showCombinationDock={false}>
        <EmptyState title="운영 권한이 없습니다" description="owner_users에 등록된 운영자 계정만 접근할 수 있습니다." />
      </PageFrame>
    )
  }

  return (
    <PageFrame chrome={chrome} showCombinationDock={false}>
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <DialogContent className="max-w-lg rounded-xl bg-white text-[#171717]">
          <DialogHeader>
            <DialogTitle className="text-[#171717]">정말 삭제할까요?</DialogTitle>
            <DialogDescription className="text-[#737373]">삭제하면 연결된 자산과 관련 방이 함께 사라질 수 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-[#ff5148]/30 bg-[#ff5148]/10 px-4 py-4 text-sm text-[#4d4d4d]">
            {pendingDelete?.name}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>취소</Button>
            <Button className="bg-[#ff5148] text-white hover:bg-[#e94740]" onClick={() => {
              if (!pendingDelete) return
              void platformApi.deleteContent(pendingDelete.entityType, pendingDelete.id)
                .then(() => {
                  toast.success('삭제했습니다.')
                  setPendingDelete(null)
                  loadDashboard()
                })
                .catch((error) => toast.error(error instanceof Error ? error.message : '삭제에 실패했습니다.'))
            }}>
              <Trash2 className="h-4 w-4" />삭제
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {!dashboard ? (
        <EmptyState title="운영실을 불러오는 중" description="잠시만 기다려주세요." />
      ) : (
        <div className="space-y-6">
          <PageSection title={`신고 큐 ${reports.length ? `(${reports.length})` : ''}`}>
            {reports.length === 0 ? <EmptyState title="검토할 신고가 없습니다" description="새 신고가 들어오면 콘텐츠와 사유가 여기에 표시됩니다." /> : <div className="space-y-3">{reports.map((report) => <div key={report.id} className="rounded-lg border border-[#e7e7e7] bg-[#ffffff] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-[#171717]">{report.entityName}</p><p className="mt-1 text-xs font-semibold text-[#ff5148]">{report.entityType === 'character' ? '캐릭터' : '월드'} · {report.reason}</p>{report.details ? <p className="mt-2 text-sm text-[#666666]">{report.details}</p> : null}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => reviewReport(report.id, 'dismiss')}>기각</Button><Button size="sm" variant="outline" onClick={() => reviewReport(report.id, 'restore')}>복구</Button><Button size="sm" className="bg-[#ff5148] text-white hover:bg-[#e94740]" onClick={() => reviewReport(report.id, 'quarantine')}>격리</Button><Button size="sm" variant="destructive" onClick={() => reviewReport(report.id, 'remove')}>차단</Button></div></div></div>)}</div>}
          </PageSection>
          <PageSection title="운영실">
            <div className="space-y-4">
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-[#171717]">캐릭터 운영</h3>
                  {[{ title: '노출 중', items: dashboard.items.visibleCharacters, entityType: 'character' as const, visible: true }, { title: '숨김', items: dashboard.items.hiddenCharacters, entityType: 'character' as const, visible: false }].map((section) => (
                    <div key={section.title} className="space-y-3 rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                      <p className="text-sm font-semibold text-[#171717]">{section.title}</p>
                      <div className="grid gap-3">
                        {section.items.map((item) => (
                          <div key={item.id} className="rounded-xl border border-[#e7e7e7] bg-[#ffffff] p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-semibold text-[#171717]">{item.name}</p>
                                <p className="mt-2 text-sm text-[#737373]">{item.summary}</p>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="outline" className={section.visible ? 'border-[#ffcc88]/40 text-[#ffd9a8] hover:bg-[#ffcc88]/10 hover:text-[#171717]' : 'border-[#62d0ff]/40 text-[#8edfff] hover:bg-[#62d0ff]/10 hover:text-[#171717]'} onClick={() => {
                                  const action = section.visible ? platformApi.hideContent : platformApi.showContent
                                  const verb = section.visible ? '숨김' : '복구'
                                  void action('character', item.id)
                                    .then(() => {
                                      toast.success(`${verb} 처리했습니다.`)
                                      loadDashboard()
                                    })
                                    .catch((error) => toast.error(error instanceof Error ? error.message : `${verb} 처리에 실패했습니다.`))
                                }}>
                                  {section.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{section.visible ? '숨김' : '복구'}
                                </Button>
                                <Button variant="outline" className="border-[#ff5148]/40 text-[#ff5148] hover:bg-[#ff5148]/10 hover:text-[#171717]" onClick={() => setPendingDelete({ entityType: 'character', id: item.id, name: item.name })}>
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
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-semibold text-[#171717]">{item.name}</p>
                                <p className="mt-2 text-sm text-[#737373]">{item.summary}</p>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="outline" className={section.visible ? 'border-[#ffcc88]/40 text-[#ffd9a8] hover:bg-[#ffcc88]/10 hover:text-[#171717]' : 'border-[#62d0ff]/40 text-[#8edfff] hover:bg-[#62d0ff]/10 hover:text-[#171717]'} onClick={() => {
                                  const action = section.visible ? platformApi.hideContent : platformApi.showContent
                                  const verb = section.visible ? '숨김' : '복구'
                                  void action('world', item.id)
                                    .then(() => {
                                      toast.success(`${verb} 처리했습니다.`)
                                      loadDashboard()
                                    })
                                    .catch((error) => toast.error(error instanceof Error ? error.message : `${verb} 처리에 실패했습니다.`))
                                }}>
                                  {section.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{section.visible ? '숨김' : '복구'}
                                </Button>
                                <Button variant="outline" className="border-[#ff5148]/40 text-[#ff5148] hover:bg-[#ff5148]/10 hover:text-[#171717]" onClick={() => setPendingDelete({ entityType: 'world', id: item.id, name: item.name })}>
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
