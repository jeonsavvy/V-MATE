import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, ImagePlus, LayoutTemplate, Loader2, MessageCircle, PlusCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CharacterDetail, CharacterSummary, CharacterWorldLinkSummary, LibraryPayload, OwnerOpsDashboard, RoomSummary, WorldDetail, WorldSummary } from '@/lib/platform/types'
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

          {item.imageSlots.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {item.imageSlots.slice(0, 6).map((slot) => (
                <div key={slot.id} className="w-[84px]">
                  <div className="overflow-hidden rounded-[1rem] border border-white/10 bg-[#121418]">
                    <img src={slot.cardUrl || slot.detailUrl || item.coverImageUrl} alt={`${item.name} ${slot.slot}`} className="aspect-[3/4] h-full w-full object-cover" loading="lazy" decoding="async" />
                  </div>
                  <p className="mt-2 truncate text-[11px] text-white/56">{slot.slot}</p>
                </div>
              ))}
            </div>
          ) : null}

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

  const activeCharacterImage = useMemo(() => {
    if (!room) return ''
    const latestAssistant = [...room.messages].reverse().find((message) => message.role === 'assistant' && typeof message.content === 'object')
    const emotion = latestAssistant && typeof latestAssistant.content === 'object' ? latestAssistant.content.emotion : 'normal'
    const slots = room.character.imageSlots || []
    const selected =
      slots.find((slot) => slot.slot === emotion) ||
      slots.find((slot) => slot.slot === 'normal') ||
      slots.find((slot) => slot.slot === 'main')
    return selected?.detailUrl || room.character.coverImageUrl
  }, [room])

  return (
    <PageFrame chrome={chrome}>
      {!room ? (
        <EmptyState title="대화를 불러오는 중" description="최근 장면과 상태를 정리하고 있습니다." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#121418]">
            <img src={activeCharacterImage} alt={room.character.name} className="h-full w-full object-cover object-top" loading="eager" decoding="async" />
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

interface ImageSlotDraft {
  id: string
  slot: string
  usage: string
  trigger: string
  priority: string
  assets: ResizedImageAsset[]
  previewUrl: string
  sourceSize: string
}

const createSlotId = () => `slot-${Math.random().toString(36).slice(2, 10)}`

const toSlotVariants = (slotId: string) =>
  CHARACTER_VARIANTS.map((variant) => ({
    ...variant,
    kind: `${slotId}:${variant.kind}`,
  }))

const createInitialCharacterSlot = (slot: string, usage: string, trigger: string, priority: string): ImageSlotDraft => ({
  id: createSlotId(),
  slot,
  usage,
  trigger,
  priority,
  assets: [],
  previewUrl: '',
  sourceSize: '',
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
  const findVariant = (variantKind: 'thumb' | 'card' | 'detail') =>
    variants.find((asset) => asset.kind === `${slot.id}:${variantKind}`)?.url || ''

  return {
    id: slot.id,
    slot: slot.slot.trim() || 'custom',
    usage: slot.usage.trim(),
    trigger: slot.trigger.trim(),
    priority: Number(slot.priority || 0),
    thumbUrl: findVariant('thumb'),
    cardUrl: findVariant('card'),
    detailUrl: findVariant('detail'),
  }
}

const splitCommaValues = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const selectStyle = { colorScheme: 'dark' as const }

export function CreateCharacterPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'unlisted' | 'public'>('private')
  const [sourceType, setSourceType] = useState<'original' | 'derivative'>('original')
  const [personality, setPersonality] = useState('')
  const [voice, setVoice] = useState('')
  const [relationship, setRelationship] = useState('')
  const [forbiddenTone, setForbiddenTone] = useState('')
  const [coreArchetype, setCoreArchetype] = useState('')
  const [speechStyle, setSpeechStyle] = useState('')
  const [socialDistanceDefault, setSocialDistanceDefault] = useState('')
  const [roleTendency, setRoleTendency] = useState('')
  const [conflictStyle, setConflictStyle] = useState('')
  const [warmthLevel, setWarmthLevel] = useState('')
  const [romanceTendency, setRomanceTendency] = useState('')
  const [tabooTopics, setTabooTopics] = useState('')
  const [worldFitTags, setWorldFitTags] = useState('')
  const [linkedWorldSlug, setLinkedWorldSlug] = useState('')
  const [linkedWorldReason, setLinkedWorldReason] = useState('')
  const [defaultOpeningContext, setDefaultOpeningContext] = useState('')
  const [defaultRelationshipContext, setDefaultRelationshipContext] = useState('')
  const [processingSlotId, setProcessingSlotId] = useState<string | null>(null)
  const [availableWorlds, setAvailableWorlds] = useState<WorldSummary[]>([])
  const [imageSlots, setImageSlots] = useState<ImageSlotDraft[]>([
    createInitialCharacterSlot('main', '대표 이미지', '기본 대표 비주얼', '100'),
    createInitialCharacterSlot('happy', '긍정적 분위기', '반가움, 편안함, 만족감이 드러날 때', '80'),
    createInitialCharacterSlot('angry', '갈등 / 감정 고조', '감정이 높아지거나 대치가 생길 때', '80'),
  ])

  useEffect(() => {
    let mounted = true
    void platformApi.fetchWorlds('', 'popular')
      .then(({ items }) => { if (mounted) setAvailableWorlds(items) })
      .catch(() => undefined)
    return () => { mounted = false }
  }, [])

  const updateSlot = (slotId: string, patch: Partial<ImageSlotDraft>) => {
    setImageSlots((prev) => prev.map((slot) => slot.id === slotId ? { ...slot, ...patch } : slot))
  }

  const handleSlotUpload = (slotId: string, file: File) => {
    setProcessingSlotId(slotId)
    void createImageVariants({ file, variants: toSlotVariants(slotId) })
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

  const mainSlot = imageSlots.find((slot) => slot.slot === 'main') || imageSlots[0]

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 캐릭터를 만들 수 있습니다" description="만든 캐릭터는 바로 홈/상세/최근 대화 흐름에 연결됩니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <PageSection title="기본 정보">
            <div className="grid gap-4">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="캐릭터 이름" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="한 줄 소개" className="bg-white/5 text-white placeholder:text-white/35" />
              <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="캐릭터 소개와 핵심 매력을 적어주세요." className="min-h-[180px] rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35" />
              <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="태그 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-white/62">
                  <span>공개 상태</span>
                  <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} className="h-12 w-full rounded-[1rem] border border-white/10 bg-[#15181d] px-4 text-white outline-none" style={selectStyle}>
                    <option className="bg-[#15181d] text-white" value="private">비공개</option>
                    <option className="bg-[#15181d] text-white" value="unlisted">링크 공개</option>
                    <option className="bg-[#15181d] text-white" value="public">전체 공개</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm text-white/62">
                  <span>원작 여부</span>
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="h-12 w-full rounded-[1rem] border border-white/10 bg-[#15181d] px-4 text-white outline-none" style={selectStyle}>
                    <option className="bg-[#15181d] text-white" value="original">오리지널</option>
                    <option className="bg-[#15181d] text-white" value="derivative">2차창작</option>
                  </select>
                </label>
              </div>
            </div>
          </PageSection>

          <PageSection title="캐릭터 설정">
            <div className="grid gap-4 md:grid-cols-3">
              <textarea value={personality} onChange={(event) => setPersonality(event.target.value)} placeholder="성격과 기본 매력을 적어주세요. 예) 무심한 척 챙기고, 가까워질수록 장난이 늘어남" className="min-h-[120px] rounded-[1.3rem] border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-white/35 md:col-span-2" />
              <textarea value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="말투를 적어주세요. 예) 짧은 문장, 반말, 무심한 어투" className="min-h-[120px] rounded-[1.3rem] border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-white/35" />
              <textarea value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="처음 대화할 때 어느 정도 거리에서 시작할지 적어주세요. 예) 낯설지만 금방 가까워질 수 있는 거리" className="min-h-[120px] rounded-[1.3rem] border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-white/35 md:col-span-2" />
              <textarea value={forbiddenTone} onChange={(event) => setForbiddenTone(event.target.value)} placeholder="피해야 할 말투나 깨지면 안 되는 설정이 있으면 적어주세요." className="min-h-[120px] rounded-[1.3rem] border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-white/35" />
              <Input value={coreArchetype} onChange={(event) => setCoreArchetype(event.target.value)} placeholder="캐릭터 한 줄 정체성" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={speechStyle} onChange={(event) => setSpeechStyle(event.target.value)} placeholder="말투 요약" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={socialDistanceDefault} onChange={(event) => setSocialDistanceDefault(event.target.value)} placeholder="초기 거리감" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={roleTendency} onChange={(event) => setRoleTendency(event.target.value)} placeholder="월드 안 역할" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={conflictStyle} onChange={(event) => setConflictStyle(event.target.value)} placeholder="갈등 반응 방식" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={warmthLevel} onChange={(event) => setWarmthLevel(event.target.value)} placeholder="따뜻함 정도" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={romanceTendency} onChange={(event) => setRomanceTendency(event.target.value)} placeholder="로맨스 결" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={tabooTopics} onChange={(event) => setTabooTopics(event.target.value)} placeholder="피해야 할 주제 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35 md:col-span-2" />
              <Input value={worldFitTags} onChange={(event) => setWorldFitTags(event.target.value)} placeholder="잘 맞는 월드 태그 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35 md:col-span-3" />
            </div>
          </PageSection>

          <PageSection title="캐릭터 이미지">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">대표 이미지 + 감정/상황별 이미지</p>
                  <p className="mt-1 text-sm leading-6 text-white/56">각 슬롯마다 다른 이미지를 넣고, 언제 써야 하는지 규칙을 함께 기록합니다.</p>
                </div>
                <Button variant="outline" onClick={() => setImageSlots((prev) => [...prev, createInitialCharacterSlot('special', '커스텀 장면', '원하는 상황을 직접 설명', '60')])}>
                  <ImagePlus className="h-4 w-4" />슬롯 추가
                </Button>
              </div>

              <div className="grid gap-4">
                {imageSlots.map((slot) => (
                  <div key={slot.id} className="grid gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-[1.2rem] border border-white/10 bg-[#111317]">
                        <div className="aspect-[3/4]">
                          {slot.previewUrl ? (
                            <img src={slot.previewUrl} alt={`${slot.slot} 미리보기`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-white/38">이미지 없음</div>
                          )}
                        </div>
                      </div>
                      <label className="block rounded-[1rem] border border-dashed border-white/12 bg-white/[0.03] px-4 py-3 text-sm text-white/62">
                        <span className="font-semibold text-white">{slot.slot} 이미지 업로드</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="mt-3 block w-full text-sm"
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (!file) return
                            handleSlotUpload(slot.id, file)
                          }}
                        />
                      </label>
                      <div className="rounded-[1rem] border border-white/10 bg-[#15181d] px-3 py-3 text-xs leading-6 text-white/56">
                        <p>권장 비율 3:4</p>
                        <p>현재 원본 {slot.sourceSize || '미선택'}</p>
                        <p>자동 크롭으로 thumb/card/detail 3종을 생성합니다.</p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Input value={slot.slot} onChange={(event) => updateSlot(slot.id, { slot: event.target.value })} placeholder="슬롯 이름 (예: happy, battle, night)" className="bg-white/5 text-white placeholder:text-white/35" />
                      <Input value={slot.priority} onChange={(event) => updateSlot(slot.id, { priority: event.target.value })} placeholder="우선순위" className="bg-white/5 text-white placeholder:text-white/35" />
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-white">이미지 설명</p>
                        <textarea value={slot.usage} onChange={(event) => updateSlot(slot.id, { usage: event.target.value })} placeholder="이 이미지가 어떤 장면을 대표하는지" className="min-h-[120px] w-full rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-white">사용 조건</p>
                        <textarea value={slot.trigger} onChange={(event) => updateSlot(slot.id, { trigger: event.target.value })} placeholder="언제 써야 하는지, 어떤 감정/상황일 때 반영할지" className="min-h-[120px] w-full rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35" />
                      </div>
                      <div className="md:col-span-2 flex justify-end">
                        {slot.slot !== 'main' ? (
                          <Button variant="outline" className="border-[#d92c63]/40 text-[#ff8ab2] hover:bg-[#d92c63]/10 hover:text-white" onClick={() => setImageSlots((prev) => prev.filter((item) => item.id !== slot.id))}>
                            <Trash2 className="h-4 w-4" />슬롯 삭제
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PageSection>

          <PageSection title="연결할 월드">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm text-white/62">
                <span>추천 월드</span>
                <select value={linkedWorldSlug} onChange={(event) => setLinkedWorldSlug(event.target.value)} className="h-12 w-full rounded-[1rem] border border-white/10 bg-[#15181d] px-4 text-white outline-none" style={selectStyle}>
                  <option className="bg-[#15181d] text-white" value="">선택 안 함</option>
                  {availableWorlds.map((world) => <option className="bg-[#15181d] text-white" key={world.id} value={world.slug}>{world.name}</option>)}
                </select>
              </label>
              <Input value={linkedWorldReason} onChange={(event) => setLinkedWorldReason(event.target.value)} placeholder="연결 이유" className="bg-white/5 text-white placeholder:text-white/35" />
              <textarea value={defaultOpeningContext} onChange={(event) => setDefaultOpeningContext(event.target.value)} placeholder="기본 오프닝 문맥" className="min-h-[120px] rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35" />
              <textarea value={defaultRelationshipContext} onChange={(event) => setDefaultRelationshipContext(event.target.value)} placeholder="기본 관계 문맥" className="min-h-[120px] rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35" />
            </div>
          </PageSection>

          <Button disabled={processingSlotId !== null || !name.trim() || !summary.trim() || !mainSlot?.assets.length} onClick={() => {
            void (async () => {
              const slotAssets = imageSlots.flatMap((slot) => slot.assets)
              const uploadedAssets = slotAssets.length > 0
                ? await uploadPreparedAssets({ entityType: 'character', assets: slotAssets })
                : []
              const imageSlotRecords = imageSlots.map((slot) => buildSlotRecord({ slot, uploadedAssets }))
              const mainRecord = imageSlotRecords.find((slot) => slot.slot === 'main') || imageSlotRecords[0]
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
              const { item } = await platformApi.createCharacter({
                name,
                headline,
                summary,
                tags: splitCommaValues(tags),
                visibility,
                sourceType,
                coverImageUrl: detailUrl,
                avatarImageUrl: cardUrl,
                assets: mainAssets,
                profileJson: {
                  personality,
                  relationship,
                  forbiddenTone,
                },
                speechStyleJson: {
                  voice,
                  forbiddenTone,
                },
                promptProfileJson: {
                  coreArchetype,
                  speechStyle,
                  socialDistanceDefault,
                  roleTendency,
                  conflictStyle,
                  warmthLevel,
                  romanceTendency,
                  tabooTopics: splitCommaValues(tabooTopics),
                  worldFitTags: splitCommaValues(worldFitTags),
                  imageSlots: imageSlotRecords,
                  linkedWorldReason,
                  linkedWorldSlug,
                  defaultOpeningContext,
                  defaultRelationshipContext,
                },
              })
              if (linkedWorldSlug && linkedWorldReason.trim()) {
                await platformApi.createCharacterWorldLink({
                  characterSlug: item.slug,
                  worldSlug: linkedWorldSlug,
                  linkReason: linkedWorldReason.trim(),
                  defaultOpeningContext,
                  defaultRelationshipContext,
                }).catch(() => undefined)
              }
              toast.success('캐릭터를 만들었습니다.')
              chrome.onNavigate(`/characters/${item.slug}`)
            })().catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터 생성에 실패했습니다.'))
          }}><PlusCircle className="h-4 w-4" />{processingSlotId ? '이미지 처리 중...' : '캐릭터 저장'}</Button>
        </div>
        <div className="space-y-4">
          <UploadHint title="업로드 규격" body="캐릭터 이미지는 3:4 비율, 최소 1440×1920 기준으로 준비합니다. 정사각형이나 세로가 짧은 이미지는 자동 크롭됩니다." />
          <UploadHint title="이미지 세트 운영" body="대표 이미지 외에 happy / angry / night / battle 같은 감정·상황 슬롯을 추가하고, 각 이미지가 언제 쓰여야 하는지 규칙을 같이 입력할 수 있습니다." />
          <UploadHint title="대화 설정 팁" body="성격/말투와 별개로 초기 거리감, 갈등 반응, 피해야 할 설정, 잘 맞는 월드 태그를 분리해서 적어두면 월드와 결합될 때 더 안정적으로 동작합니다." />
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
  const [visibility, setVisibility] = useState<'private' | 'unlisted' | 'public'>('private')
  const [sourceType, setSourceType] = useState<'original' | 'derivative'>('original')
  const [rules, setRules] = useState('')
  const [genre, setGenre] = useState('')
  const [settingPeriod, setSettingPeriod] = useState('')
  const [powerSystem, setPowerSystem] = useState('')
  const [socialStructure, setSocialStructure] = useState('')
  const [starterLocations, setStarterLocations] = useState('')
  const [dangerLevel, setDangerLevel] = useState('')
  const [toneKeywords, setToneKeywords] = useState('')
  const [roleSlots, setRoleSlots] = useState('')
  const [forbiddenBreaks, setForbiddenBreaks] = useState('')
  const [worldTerms, setWorldTerms] = useState('')
  const [recommendedCharacterSlug, setRecommendedCharacterSlug] = useState('')
  const [recommendedCharacterReason, setRecommendedCharacterReason] = useState('')
  const [isProcessingImage, setIsProcessingImage] = useState(false)
  const [imageAssets, setImageAssets] = useState<ResizedImageAsset[]>([])
  const [availableCharacters, setAvailableCharacters] = useState<CharacterSummary[]>([])

  useEffect(() => {
    let mounted = true
    void platformApi.fetchCharacters('', 'popular')
      .then(({ items }) => { if (mounted) setAvailableCharacters(items) })
      .catch(() => undefined)
    return () => { mounted = false }
  }, [])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 월드를 만들 수 있습니다" description="만든 월드는 캐릭터와 연결해 바로 새 대화를 시작할 수 있습니다." />
  }

  return (
    <PageFrame chrome={chrome}>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <PageSection title="기본 정보">
            <div className="grid gap-4">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="월드 이름" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="한 줄 설명" className="bg-white/5 text-white placeholder:text-white/35" />
              <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="월드 설명" className="min-h-[160px] rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35" />
              <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="태그 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-white/62">
                  <span>공개 상태</span>
                  <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} className="h-12 w-full rounded-[1rem] border border-white/10 bg-[#15181d] px-4 text-white outline-none" style={selectStyle}>
                    <option className="bg-[#15181d] text-white" value="private">비공개</option>
                    <option className="bg-[#15181d] text-white" value="unlisted">링크 공개</option>
                    <option className="bg-[#15181d] text-white" value="public">전체 공개</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm text-white/62">
                  <span>원작 여부</span>
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="h-12 w-full rounded-[1rem] border border-white/10 bg-[#15181d] px-4 text-white outline-none" style={selectStyle}>
                    <option className="bg-[#15181d] text-white" value="original">오리지널</option>
                    <option className="bg-[#15181d] text-white" value="derivative">2차창작</option>
                  </select>
                </label>
              </div>
            </div>
          </PageSection>

          <PageSection title="월드 설명">
            <div className="grid gap-4 md:grid-cols-2">
              <Input value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="장르" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={settingPeriod} onChange={(event) => setSettingPeriod(event.target.value)} placeholder="시대 / 배경 시간" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={powerSystem} onChange={(event) => setPowerSystem(event.target.value)} placeholder="힘의 규칙 (예: 마법, 초능력, 장비)" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={socialStructure} onChange={(event) => setSocialStructure(event.target.value)} placeholder="사회 구조 (예: 길드, 학교, 조직)" className="bg-white/5 text-white placeholder:text-white/35" />
              <textarea value={rules} onChange={(event) => setRules(event.target.value)} placeholder="월드 규칙" className="min-h-[140px] rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 md:col-span-2" />
            </div>
          </PageSection>

          <PageSection title="장르 / 무드 / 장소">
            <div className="grid gap-4 md:grid-cols-2">
              <Input value={starterLocations} onChange={(event) => setStarterLocations(event.target.value)} placeholder="첫 장면 장소 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={dangerLevel} onChange={(event) => setDangerLevel(event.target.value)} placeholder="위험도 / 긴장감" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={toneKeywords} onChange={(event) => setToneKeywords(event.target.value)} placeholder="무드 키워드 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
              <Input value={roleSlots} onChange={(event) => setRoleSlots(event.target.value)} placeholder="어울리는 역할 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
              <textarea value={forbiddenBreaks} onChange={(event) => setForbiddenBreaks(event.target.value)} placeholder="깨지면 안 되는 월드 규칙 / 금지 전개" className="min-h-[120px] rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35" />
              <textarea value={worldTerms} onChange={(event) => setWorldTerms(event.target.value)} placeholder="월드 안에서 자주 쓰는 용어, 조직명, 장소명" className="min-h-[120px] rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35" />
            </div>
          </PageSection>

          <PageSection title="추천 캐릭터 연결">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm text-white/62">
                <span>추천 캐릭터</span>
                <select value={recommendedCharacterSlug} onChange={(event) => setRecommendedCharacterSlug(event.target.value)} className="h-12 w-full rounded-[1rem] border border-white/10 bg-[#15181d] px-4 text-white outline-none" style={selectStyle}>
                  <option className="bg-[#15181d] text-white" value="">선택 안 함</option>
                  {availableCharacters.map((character) => <option className="bg-[#15181d] text-white" key={character.id} value={character.slug}>{character.name}</option>)}
                </select>
              </label>
              <Input value={recommendedCharacterReason} onChange={(event) => setRecommendedCharacterReason(event.target.value)} placeholder="연결 이유" className="bg-white/5 text-white placeholder:text-white/35" />
            </div>
          </PageSection>

          <PageSection title="월드 이미지">
            <div className="space-y-4">
              <label className="rounded-[1.5rem] border border-dashed border-white/12 bg-white/[0.03] px-4 py-4 text-sm text-white/62">
                <span className="font-semibold text-white">월드 이미지 업로드</span>
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
                        toast.success('월드 이미지 파생본을 생성했습니다.')
                      })
                      .catch((error) => toast.error(error instanceof Error ? error.message : '이미지 처리에 실패했습니다.'))
                      .finally(() => setIsProcessingImage(false))
                  }}
                />
              </label>
            </div>
          </PageSection>

          <Button disabled={isProcessingImage || !name.trim() || !summary.trim() || imageAssets.length === 0} onClick={() => {
              void (async () => {
                const uploadedAssets = imageAssets.length > 0
                  ? await uploadPreparedAssets({ entityType: 'world', assets: imageAssets })
                  : []
                const heroUrl = uploadedAssets.find((asset) => asset.kind === 'hero')?.url || ''
                const { item } = await platformApi.createWorld({
                  name,
                  headline,
                  summary,
                  tags: splitCommaValues(tags),
                  visibility,
                  sourceType,
                  coverImageUrl: heroUrl,
                  worldRulesMarkdown: rules,
                  assets: uploadedAssets,
                  promptProfileJson: {
                    genreKey: genre,
                    genre,
                    settingPeriod,
                    powerSystem,
                    socialStructure,
                    starterLocations: splitCommaValues(starterLocations),
                    dangerLevel,
                    toneKeywords: splitCommaValues(toneKeywords),
                    roleSlots: splitCommaValues(roleSlots),
                    forbiddenBreaks: splitCommaValues(forbiddenBreaks),
                    worldTerms: splitCommaValues(worldTerms),
                  },
                })
                if (recommendedCharacterSlug && recommendedCharacterReason.trim()) {
                  await platformApi.createCharacterWorldLink({
                    characterSlug: recommendedCharacterSlug,
                    worldSlug: item.slug,
                    linkReason: recommendedCharacterReason.trim(),
                  }).catch(() => undefined)
                }
                toast.success('월드를 만들었습니다.')
                chrome.onNavigate(`/worlds/${item.slug}`)
              })().catch((error) => toast.error(error instanceof Error ? error.message : '월드 생성에 실패했습니다.'))
            }}><PlusCircle className="h-4 w-4" />{isProcessingImage ? '이미지 처리 중...' : '월드 저장'}</Button>
        </div>
        <div className="space-y-4">
          <UploadHint title="업로드 규격" body="월드 이미지는 16:9 비율, 최소 1600×900 기준으로 준비합니다. 가로형 커버를 기준으로 자동 크롭합니다." />
          <UploadHint title="월드 설계 팁" body="장르/시대/사회 구조/역할 슬롯/금지 깨짐 포인트를 분리해서 적어두면 아무 캐릭터와 붙어도 월드 결이 덜 무너집니다." />
          <UploadHint title="연결 관리" body="월드는 여러 캐릭터와 연결될 수 있습니다. 추천 캐릭터를 먼저 한 명 잡고, 링크 이유를 적어두면 상세와 새 대화 시작 흐름이 더 자연스럽습니다." />
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
  const [isForbidden, setIsForbidden] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ entityType: 'character' | 'world'; id: string; name: string } | null>(null)

  const loadDashboard = () => {
    void platformApi.fetchOpsDashboard()
      .then((data) => {
        setDashboard(data)
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

  useEffect(() => {
    if (!chrome.user) return
    loadDashboard()
  }, [chrome.user])

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 운영실에 접근할 수 있습니다" description="운영자 권한이 있는 계정만 접근 가능합니다." />
  }

  if (isForbidden) {
    return (
      <PageFrame chrome={chrome}>
        <EmptyState title="운영 권한이 없습니다" description="profiles.is_owner 또는 owner_user_ids 설정이 필요한 계정입니다." />
      </PageFrame>
    )
  }

  return (
    <PageFrame chrome={chrome}>
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <DialogContent className="max-w-lg rounded-[2rem] bg-[#20242b] text-white">
          <DialogHeader>
            <DialogTitle className="text-white">정말 삭제할까요?</DialogTitle>
            <DialogDescription className="text-white/56">삭제하면 연결된 자산과 링크, 관련 방이 함께 사라질 수 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="rounded-[1.2rem] border border-[#d92c63]/30 bg-[#d92c63]/10 px-4 py-4 text-sm text-white/78">
            {pendingDelete?.name}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>취소</Button>
            <Button className="bg-[#d92c63] text-white hover:bg-[#c12358]" onClick={() => {
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
          <PageSection title="운영실">
            <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="space-y-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">메인 배너</h3>
                    <p className="mt-1 text-sm text-white/56">자동이면 실제 사용지표 상위 콘텐츠를, 수동이면 선택한 대상만 배너로 씁니다.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button className={dashboard.home.heroMode === 'auto' ? 'bg-[#d92c63] text-white hover:bg-[#c12358]' : 'border-white/14 bg-[#15181d] text-white hover:bg-white/8'} variant={dashboard.home.heroMode === 'auto' ? 'default' : 'outline'} onClick={() => {
                      void platformApi.setBannerMode('auto')
                        .then(() => {
                          toast.success('배너를 자동 모드로 전환했습니다.')
                          loadDashboard()
                        })
                        .catch((error) => toast.error(error instanceof Error ? error.message : '배너 모드 변경에 실패했습니다.'))
                    }}>
                      <LayoutTemplate className="h-4 w-4" />자동
                    </Button>
                    <Button className={dashboard.home.heroMode === 'manual' ? 'bg-[#d92c63] text-white hover:bg-[#c12358]' : 'border-white/14 bg-[#15181d] text-white hover:bg-white/8'} variant={dashboard.home.heroMode === 'manual' ? 'default' : 'outline'} onClick={() => {
                      void platformApi.setBannerMode('manual')
                        .then(() => {
                          toast.success('배너를 수동 모드로 전환했습니다.')
                          loadDashboard()
                        })
                        .catch((error) => toast.error(error instanceof Error ? error.message : '배너 모드 변경에 실패했습니다.'))
                    }}>
                      <LayoutTemplate className="h-4 w-4" />수동
                    </Button>
                  </div>
                </div>
                <div className="rounded-[1.2rem] border border-white/10 bg-[#15181d] px-4 py-4 text-sm text-white/62">
                  현재 타깃: {dashboard.home.heroTargetPath || '자동 상위 콘텐츠'}
                </div>
                <div className="grid gap-3">
                  {[...dashboard.items.visibleCharacters, ...dashboard.items.visibleWorlds].slice(0, 8).map((item) => {
                    const targetPath = item.entityType === 'character' ? `/characters/${item.slug}` : `/worlds/${item.slug}`
                    return (
                      <div key={targetPath} className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-white/10 bg-[#15181d] px-4 py-4">
                        <div>
                          <p className="font-semibold text-white">{item.name}</p>
                          <p className="mt-1 text-sm text-white/52">{item.summary}</p>
                        </div>
                        <Button variant="outline" className="border-white/14 bg-[#15181d] text-white hover:bg-white/8" onClick={() => {
                          void platformApi.setBannerTarget(targetPath)
                            .then(() => {
                              toast.success('배너 대상을 변경했습니다.')
                              loadDashboard()
                            })
                            .catch((error) => toast.error(error instanceof Error ? error.message : '배너 대상 변경에 실패했습니다.'))
                        }}>
                          배너 지정
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-white">캐릭터 운영</h3>
                  {[{ title: '노출 중', items: dashboard.items.visibleCharacters, entityType: 'character' as const, visible: true }, { title: '숨김', items: dashboard.items.hiddenCharacters, entityType: 'character' as const, visible: false }].map((section) => (
                    <div key={section.title} className="space-y-3 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-sm font-semibold text-white">{section.title}</p>
                      <div className="grid gap-3">
                        {section.items.map((item) => (
                          <div key={item.id} className="rounded-[1.2rem] border border-white/10 bg-[#15181d] p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-semibold text-white">{item.name}</p>
                                <p className="mt-2 text-sm text-white/56">{item.summary}</p>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="outline" className={section.visible ? 'border-[#ffcc88]/40 text-[#ffd9a8] hover:bg-[#ffcc88]/10 hover:text-white' : 'border-[#62d0ff]/40 text-[#8edfff] hover:bg-[#62d0ff]/10 hover:text-white'} onClick={() => {
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
                                <Button variant="outline" className="border-[#d92c63]/40 text-[#ff8ab2] hover:bg-[#d92c63]/10 hover:text-white" onClick={() => setPendingDelete({ entityType: 'character', id: item.id, name: item.name })}>
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
                  <h3 className="text-lg font-semibold text-white">월드 운영</h3>
                  {[{ title: '노출 중', items: dashboard.items.visibleWorlds, entityType: 'world' as const, visible: true }, { title: '숨김', items: dashboard.items.hiddenWorlds, entityType: 'world' as const, visible: false }].map((section) => (
                    <div key={section.title} className="space-y-3 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-sm font-semibold text-white">{section.title}</p>
                      <div className="grid gap-3">
                        {section.items.map((item) => (
                          <div key={item.id} className="rounded-[1.2rem] border border-white/10 bg-[#15181d] p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-semibold text-white">{item.name}</p>
                                <p className="mt-2 text-sm text-white/56">{item.summary}</p>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="outline" className={section.visible ? 'border-[#ffcc88]/40 text-[#ffd9a8] hover:bg-[#ffcc88]/10 hover:text-white' : 'border-[#62d0ff]/40 text-[#8edfff] hover:bg-[#62d0ff]/10 hover:text-white'} onClick={() => {
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
                                <Button variant="outline" className="border-[#d92c63]/40 text-[#ff8ab2] hover:bg-[#d92c63]/10 hover:text-white" onClick={() => setPendingDelete({ entityType: 'world', id: item.id, name: item.name })}>
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
            </div>
          </PageSection>
        </div>
      )}
    </PageFrame>
  )
}
