import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, MessageCircle, PlusCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { CharacterDetail, CharacterSummary, CharacterWorldLinkSummary, LibraryPayload, OwnerOpsDashboard, RoomSummary, WorldDetail } from '@/lib/platform/types'
import { platformApi } from '@/lib/platform/apiClient'
import { CHARACTER_VARIANTS, createImageVariants, type ResizedImageAsset, WORLD_VARIANTS } from '@/lib/platform/imagePipeline'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EmptyState, EntityCard, LinkCard, PageSection, PlatformShell } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

const PageFrame = ({ chrome, children }: { chrome: PlatformPageChromeProps; children: ReactNode }) => (
  <PlatformShell
    user={chrome.user}
    userAvatarInitial={chrome.userAvatarInitial}
    searchValue={chrome.searchQuery}
    onSearchChange={chrome.onSearchChange}
    onNavigate={chrome.onNavigate}
    onAuthRequest={chrome.onAuthRequest}
    onSignOut={chrome.onSignOut}
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
  links,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  links: CharacterWorldLinkSummary[]
  onSelect: (link: CharacterWorldLinkSummary | null) => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-3xl rounded-[2rem] bg-[#20242b] text-white">
      <DialogHeader>
        <DialogTitle className="text-white">월드를 골라 새 대화를 시작하세요</DialogTitle>
        <DialogDescription className="text-white/56">월드를 고르면 캐릭터 결은 유지한 채 그 월드 규칙 안으로 자연스럽게 연결됩니다.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <LinkCard title="캐릭터 단독으로 시작" body="월드 없이 캐릭터 자체의 결로 바로 대화를 시작합니다." onClick={() => onSelect(null)} />
        {links.map((link) => (
          <LinkCard key={link.id} title={link.world.name} body={link.linkReason} onClick={() => onSelect(link)} />
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
      <DialogContent className="max-w-lg rounded-[2rem] bg-[#20242b] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">캐릭터가 알아야 하는 이름을 입력해주세요</DialogTitle>
          <DialogDescription className="text-white/56">설정된 이름으로 캐릭터가 당신을 부르게 됩니다.</DialogDescription>
        </DialogHeader>
        <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="이름" className="bg-white/5 text-white placeholder:text-white/35" />
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onConfirm('나')}>건너뛰기</Button>
          <Button onClick={() => onConfirm(value.trim() || '나')}>새 대화 시작</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CharacterDetailPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  const [item, setItem] = useState<CharacterDetail | null>(null)
  const [links, setLinks] = useState<CharacterWorldLinkSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingLink, setPendingLink] = useState<CharacterWorldLinkSummary | null | undefined>(undefined)
  const [aliasOpen, setAliasOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    void Promise.all([platformApi.fetchCharacter(slug), platformApi.fetchCharacterWorldLinks(slug)])
      .then(([character, worldLinks]) => {
        if (!mounted) return
        setItem(character.item)
        setLinks(worldLinks.items)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [slug])

  const startRoom = (selectedLink: CharacterWorldLinkSummary | null, aliasOverride?: string) => {
    if (!item) return
    void platformApi.createRoom({ characterSlug: item.slug, worldSlug: selectedLink?.worldSlug || null, userAlias: aliasOverride })
      .then(({ room }) => chrome.onNavigate(`/rooms/${room.id}`))
      .catch((error) => toast.error(error instanceof Error ? error.message : '새 대화 시작에 실패했습니다.'))
  }

  const handleStart = (selectedLink: CharacterWorldLinkSummary | null) => {
    if (!chrome.user) {
      chrome.onAuthRequest()
      return
    }
    const displayName = String(chrome.user.user_metadata?.name || '').trim()
    if (!displayName) {
      setPendingLink(selectedLink)
      setAliasOpen(true)
      return
    }
    startRoom(selectedLink, displayName)
  }

  if (!item) {
    return <PageFrame chrome={chrome}><EmptyState title="캐릭터를 불러오는 중" description="잠시만 기다려주세요." /></PageFrame>
  }

  return (
    <PageFrame chrome={chrome}>
      <CharacterWorldPicker open={pickerOpen} onOpenChange={setPickerOpen} links={links} onSelect={(link) => { setPickerOpen(false); handleStart(link) }} />
      <AliasDialog open={aliasOpen} initialValue={String(chrome.user?.user_metadata?.name || '')} onConfirm={(value) => { setAliasOpen(false); startRoom(pendingLink ?? null, value) }} />
      <div className="grid gap-6 xl:grid-cols-[0.84fr_1.16fr]">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#121418] xl:max-h-[720px]">
          <img src={item.coverImageUrl} alt={item.name} className="h-full w-full object-cover object-top" loading="eager" decoding="async" />
        </div>
        <div className="space-y-6 rounded-[2rem] border border-white/10 bg-[#20242b] p-6">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/42">캐릭터</p>
            <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.6rem)] font-semibold tracking-[-0.04em] text-white">{item.name}</h1>
            <p className="mt-3 text-base leading-8 text-white/64">{item.summary}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {item.tags.map((tag) => <span key={tag} className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/72">{tag}</span>)}
          </div>

          <div className="text-sm text-white/46">{item.creator.name}</div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => handleStart(null)}><MessageCircle className="h-4 w-4" />캐릭터와 바로 대화</Button>
            <Button variant="outline" onClick={() => setPickerOpen(true)}>월드 선택 후 시작</Button>
          </div>

          <PageSection title="프로필" className="bg-white/[0.03]">
            <div className="grid gap-3 md:grid-cols-2">
              {item.profileSections.map((section) => <LinkCard key={section.title} title={section.title} body={section.body} />)}
            </div>
          </PageSection>
        </div>
      </div>
    </PageFrame>
  )
}

export function WorldDetailPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  const [item, setItem] = useState<WorldDetail | null>(null)
  const [aliasOpen, setAliasOpen] = useState(false)
  const [pendingCharacter, setPendingCharacter] = useState<CharacterSummary | null>(null)

  useEffect(() => {
    let mounted = true
    void platformApi.fetchWorld(slug)
      .then(({ item }) => { if (mounted) setItem(item) })
      .catch((error) => toast.error(error instanceof Error ? error.message : '월드를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [slug])

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

  if (!item) {
    return <PageFrame chrome={chrome}><EmptyState title="월드를 불러오는 중" description="잠시만 기다려주세요." /></PageFrame>
  }

  return (
    <PageFrame chrome={chrome}>
      <AliasDialog open={aliasOpen} initialValue={String(chrome.user?.user_metadata?.name || '')} onConfirm={(value) => { setAliasOpen(false); if (pendingCharacter) startRoom(pendingCharacter, value) }} />
      <div className="space-y-6">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#121418]">
          <img src={item.coverImageUrl} alt={item.name} className="h-[360px] w-full object-cover" loading="eager" decoding="async" />
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
          <div className="space-y-6 rounded-[2rem] border border-white/10 bg-[#20242b] p-6">
            <div>
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/42">월드</p>
              <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.4rem)] font-semibold tracking-[-0.04em] text-white">{item.name}</h1>
              <p className="mt-3 text-base leading-8 text-white/64">{item.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {item.tags.map((tag) => <span key={tag} className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/72">{tag}</span>)}
            </div>
            <PageSection title="월드 정보" className="bg-white/[0.03]">
              <div className="grid gap-3 md:grid-cols-2">
                {item.worldSections.map((section) => <LinkCard key={section.title} title={section.title} body={section.body} />)}
              </div>
            </PageSection>
          </div>
          <PageSection title="이 월드에서 잘 맞는 캐릭터" className="bg-[#20242b]">
            <div className="grid gap-4 md:grid-cols-2">
              {item.characters.map((character) => <EntityCard key={character.id} item={character} meta={character.creator.name} onClick={() => handleStart(character)} cta="이 캐릭터로 시작" />)}
            </div>
          </PageSection>
        </div>
      </div>
    </PageFrame>
  )
}

const StateCard = ({ title, items }: { title: string; items: string[] }) => (
  <div className="rounded-[1.3rem] border border-white/10 bg-white/[0.04] p-4">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">{title}</p>
    <ul className="mt-3 space-y-2 text-sm leading-6 text-white/72">
      {items.length === 0 ? <li>없음</li> : items.map((item) => <li key={item}>• {item}</li>)}
    </ul>
  </div>
)

const NarrativeMessage = ({ message }: { message: RoomSummary['messages'][number] }) => {
  if (message.role === 'user') {
    return <p className="rounded-[1.4rem] bg-white/[0.06] px-4 py-3 text-sm leading-7 text-white">{message.content as string}</p>
  }
  const payload = message.content as Extract<RoomSummary['messages'][number]['content'], object>
  return (
    <div className="space-y-3 rounded-[1.6rem] border border-white/10 bg-[#121418] p-5">
      {payload.narration ? <p className="text-sm leading-7 text-white/58">{payload.narration}</p> : null}
      <p className="text-base leading-8 text-white">{payload.response}</p>
      {payload.inner_heart ? <details className="rounded-[1rem] bg-white/[0.04] px-3 py-2 text-sm text-white/68"><summary className="cursor-pointer font-semibold text-white/72">속마음 보기</summary><p className="mt-2 leading-6">{payload.inner_heart}</p></details> : null}
    </div>
  )
}

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

export function RoomPage({ chrome, roomId }: { chrome: PlatformPageChromeProps; roomId: string }) {
  const [room, setRoom] = useState<RoomSummary | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!chrome.user) return
    let mounted = true
    void platformApi.fetchRoom(roomId)
      .then(({ room }) => { if (mounted) setRoom(room) })
      .catch((error) => toast.error(error instanceof Error ? error.message : '대화를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [chrome.user, roomId])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 대화를 이어갈 수 있습니다" description="캐릭터 단독 대화도, 월드 안에서의 대화도 로그인 후 저장됩니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      {!room ? (
        <EmptyState title="대화를 불러오는 중" description="최근 장면과 상태를 정리하고 있습니다." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#121418]">
            <img src={room.character.coverImageUrl} alt={room.character.name} className="h-full w-full object-cover object-top" loading="eager" decoding="async" />
          </div>
          <div className="space-y-6 rounded-[2rem] border border-white/10 bg-[#20242b] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/42">최근 대화</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">{room.title}</h1>
                <p className="mt-1 text-sm text-white/52">{room.userAlias} · {room.character.name}{room.world ? ` · ${room.world.name}` : ''}</p>
              </div>
              <Button variant="outline" onClick={() => chrome.onNavigate(room.world ? `/worlds/${room.world.slug}` : `/characters/${room.character.slug}`)}>
                <ArrowLeft className="h-4 w-4" />돌아가기
              </Button>
            </div>

            <div className="space-y-4">
              {room.messages.map((message) => <NarrativeMessage key={message.id} message={message} />)}
              {isLoading ? <div className="text-sm text-white/46"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />응답을 생성하는 중...</div> : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <StateCard title="현재 상황" items={[room.state.currentSituation, room.state.location, room.state.relationshipState]} />
              <StateCard title="월드 메모" items={room.state.worldNotes} />
              <StateCard title="소지품" items={room.state.inventory} />
              <StateCard title="의상/자세" items={[...room.state.appearance, ...room.state.pose]} />
              <StateCard title="미래 일정/약속" items={room.state.futurePromises} />
            </div>

            <div className="space-y-3 border-t border-white/8 pt-4">
              <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="대사를 입력하세요. 예) 반가워!" className="min-h-[160px] w-full rounded-[1.5rem] border border-white/10 bg-[#121418] px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/28" />
              <div className="flex justify-end">
                <Button disabled={isLoading || !input.trim()} onClick={() => {
                  if (!input.trim()) return
                  setIsLoading(true)
                  void platformApi.sendRoomMessage(room.id, input.trim())
                    .then((payload) => {
                      setRoom(payload.room)
                      setInput('')
                    })
                    .catch((error) => toast.error(error instanceof Error ? error.message : '메시지 전송에 실패했습니다.'))
                    .finally(() => setIsLoading(false))
                }}>보내기</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  )
}

const UploadHint = ({ title, body }: { title: string; body: string }) => (
  <div className="rounded-[1.3rem] border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-white/62">
    <p className="font-semibold text-white">{title}</p>
    <p className="mt-2">{body}</p>
  </div>
)

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

export function CreateCharacterPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [isProcessingImage, setIsProcessingImage] = useState(false)
  const [imageAssets, setImageAssets] = useState<ResizedImageAsset[]>([])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 캐릭터를 만들 수 있습니다" description="만든 캐릭터는 바로 홈/상세/최근 대화 흐름에 연결됩니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <PageSection title="캐릭터 만들기">
          <div className="grid gap-4">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="캐릭터 이름" className="bg-white/5 text-white placeholder:text-white/35" />
            <Input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="한 줄 설명" className="bg-white/5 text-white placeholder:text-white/35" />
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="캐릭터 설명" className="min-h-[180px] rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35" />
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="태그 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
            <label className="rounded-[1.5rem] border border-dashed border-white/12 bg-white/[0.03] px-4 py-4 text-sm text-white/62">
              <span className="font-semibold text-white">대표 이미지 업로드</span>
              <input
                type="file"
                accept="image/*"
                className="mt-3 block w-full text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setIsProcessingImage(true)
                  void createImageVariants({ file, variants: CHARACTER_VARIANTS })
                    .then((assets) => {
                      setImageAssets(assets)
                      const detail = assets.find((asset) => asset.kind === 'detail')
                      setCoverImageUrl(detail?.dataUrl || assets[0]?.dataUrl || '')
                      toast.success('캐릭터 이미지 파생본을 생성했습니다.')
                    })
                    .catch((error) => toast.error(error instanceof Error ? error.message : '이미지 처리에 실패했습니다.'))
                    .finally(() => setIsProcessingImage(false))
                }}
              />
            </label>
            <Input value={coverImageUrl} onChange={(event) => setCoverImageUrl(event.target.value)} placeholder="대표 이미지 URL 또는 업로드 결과 URL" className="bg-white/5 text-white placeholder:text-white/35" />
            <Button disabled={isProcessingImage} onClick={() => {
              void (async () => {
                const uploadedAssets = imageAssets.length > 0
                  ? await uploadPreparedAssets({ entityType: 'character', assets: imageAssets })
                  : []
                const detailUrl = uploadedAssets.find((asset) => asset.kind === 'detail')?.url || coverImageUrl
                const cardUrl = uploadedAssets.find((asset) => asset.kind === 'card')?.url || detailUrl
                const { item } = await platformApi.createCharacter({
                  name,
                  headline,
                  summary,
                  tags: tags.split(',').map((value) => value.trim()).filter(Boolean),
                  visibility: 'private',
                  sourceType: 'original',
                  coverImageUrl: detailUrl,
                  avatarImageUrl: cardUrl,
                  assets: uploadedAssets,
                })
                toast.success('캐릭터를 만들었습니다.')
                chrome.onNavigate(`/characters/${item.slug}`)
              })().catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터 생성에 실패했습니다.'))
            }}><PlusCircle className="h-4 w-4" />{isProcessingImage ? '이미지 처리 중...' : '캐릭터 저장'}</Button>
          </div>
        </PageSection>
        <div className="space-y-4">
          <UploadHint title="업로드 규격" body="캐릭터 이미지는 3:4 비율, 최소 1440x1920 기준으로 준비합니다." />
          <UploadHint title="최적화 방식" body="브라우저에서 thumb/card/detail 3종으로 리사이즈한 뒤 저장하도록 연결합니다." />
        </div>
      </div>
    </PageFrame>
  )
}

export function CreateWorldPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [rules, setRules] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [isProcessingImage, setIsProcessingImage] = useState(false)
  const [imageAssets, setImageAssets] = useState<ResizedImageAsset[]>([])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 월드를 만들 수 있습니다" description="만든 월드는 캐릭터와 연결해 바로 새 대화를 시작할 수 있습니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <PageSection title="월드 만들기">
          <div className="grid gap-4">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="월드 이름" className="bg-white/5 text-white placeholder:text-white/35" />
            <Input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="한 줄 설명" className="bg-white/5 text-white placeholder:text-white/35" />
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="월드 설명" className="min-h-[160px] rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35" />
            <textarea value={rules} onChange={(event) => setRules(event.target.value)} placeholder="월드 규칙" className="min-h-[140px] rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35" />
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="태그 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
            <label className="rounded-[1.5rem] border border-dashed border-white/12 bg-white/[0.03] px-4 py-4 text-sm text-white/62">
              <span className="font-semibold text-white">월드 커버 업로드</span>
              <input
                type="file"
                accept="image/*"
                className="mt-3 block w-full text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setIsProcessingImage(true)
                  void createImageVariants({ file, variants: WORLD_VARIANTS })
                    .then((assets) => {
                      setImageAssets(assets)
                      const hero = assets.find((asset) => asset.kind === 'hero')
                      setCoverImageUrl(hero?.dataUrl || assets[0]?.dataUrl || '')
                      toast.success('월드 이미지 파생본을 생성했습니다.')
                    })
                    .catch((error) => toast.error(error instanceof Error ? error.message : '이미지 처리에 실패했습니다.'))
                    .finally(() => setIsProcessingImage(false))
                }}
              />
            </label>
            <Input value={coverImageUrl} onChange={(event) => setCoverImageUrl(event.target.value)} placeholder="월드 커버 URL 또는 업로드 결과 URL" className="bg-white/5 text-white placeholder:text-white/35" />
            <Button disabled={isProcessingImage} onClick={() => {
              void (async () => {
                const uploadedAssets = imageAssets.length > 0
                  ? await uploadPreparedAssets({ entityType: 'world', assets: imageAssets })
                  : []
                const heroUrl = uploadedAssets.find((asset) => asset.kind === 'hero')?.url || coverImageUrl
                const { item } = await platformApi.createWorld({
                  name,
                  headline,
                  summary,
                  tags: tags.split(',').map((value) => value.trim()).filter(Boolean),
                  visibility: 'private',
                  sourceType: 'original',
                  coverImageUrl: heroUrl,
                  worldRulesMarkdown: rules,
                  assets: uploadedAssets,
                })
                toast.success('월드를 만들었습니다.')
                chrome.onNavigate(`/worlds/${item.slug}`)
              })().catch((error) => toast.error(error instanceof Error ? error.message : '월드 생성에 실패했습니다.'))
            }}><PlusCircle className="h-4 w-4" />{isProcessingImage ? '이미지 처리 중...' : '월드 저장'}</Button>
          </div>
        </PageSection>
        <div className="space-y-4">
          <UploadHint title="업로드 규격" body="월드 이미지는 16:9 비율, 최소 1600x900 기준으로 준비합니다." />
          <UploadHint title="최적화 방식" body="thumb/card/hero 3종 파생본을 생성해 홈/상세/목록에서 목적별로 사용합니다." />
        </div>
      </div>
    </PageFrame>
  )
}

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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((room) => <LinkCard key={room.id} title={room.title} body={room.state.currentSituation} onClick={() => chrome.onNavigate(`/rooms/${room.id}`)} />)}
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
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {library.bookmarks.map((entry) => <EntityCard key={entry.id} item={entry.item} onClick={() => chrome.onNavigate(entry.entityType === 'character' ? `/characters/${entry.item.slug}` : `/worlds/${entry.item.slug}`)} />)}
              </div>
            )}
          </PageSection>

          <PageSection title="최근 본 항목">
            {library.recentViews.length === 0 ? <EmptyState title="아직 최근 본 항목이 없습니다" description="상세 페이지를 둘러보면 여기에 쌓입니다." /> : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {library.recentViews.map((entry) => <EntityCard key={entry.id} item={entry.item} onClick={() => chrome.onNavigate(entry.entityType === 'character' ? `/characters/${entry.item.slug}` : `/worlds/${entry.item.slug}`)} />)}
              </div>
            )}
          </PageSection>
        </div>
      )}
    </PageFrame>
  )
}

export function OpsPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [dashboard, setDashboard] = useState<OwnerOpsDashboard | null>(null)

  useEffect(() => {
    let mounted = true
    void platformApi.fetchOpsDashboard()
      .then((data) => { if (mounted) setDashboard(data) })
      .catch((error) => toast.error(error instanceof Error ? error.message : '운영실 데이터를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [])

  return (
    <PageFrame chrome={chrome}>
      {!dashboard ? (
        <EmptyState title="운영실을 불러오는 중" description="잠시만 기다려주세요." />
      ) : (
        <div className="space-y-6">
          <PageSection title="운영실">
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white">노출 중인 캐릭터</h3>
                <div className="grid gap-3">
                  {dashboard.items.visibleCharacters.map((item) => <LinkCard key={item.id} title={item.name} body={item.summary} onClick={() => { void platformApi.hideContent('character', item.id).then(() => toast.success('숨김 처리했습니다.')) }} />)}
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white">노출 중인 월드</h3>
                <div className="grid gap-3">
                  {dashboard.items.visibleWorlds.map((item) => <LinkCard key={item.id} title={item.name} body={item.summary} onClick={() => { void platformApi.hideContent('world', item.id).then(() => toast.success('숨김 처리했습니다.')) }} />)}
                </div>
              </div>
            </div>
          </PageSection>
        </div>
      )}
    </PageFrame>
  )
}
