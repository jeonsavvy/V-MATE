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
import { ArtworkFrame, EmptyState, EntityCard, LinkCard, PageSection, PlatformShell } from '@/components/platform/PlatformScaffold'
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
    <DialogContent className="max-w-3xl rounded-[2rem] bg-[#20242b] text-white">
      <DialogHeader>
        <DialogTitle className="text-white">{title}</DialogTitle>
        <DialogDescription className="text-white/56">{description}</DialogDescription>
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
  const [availableWorlds, setAvailableWorlds] = useState<WorldSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorldSlug, setPendingWorldSlug] = useState<string | null | undefined>(undefined)
  const [aliasOpen, setAliasOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    void Promise.all([platformApi.fetchCharacter(slug), platformApi.fetchCharacterWorldLinks(slug), platformApi.fetchWorlds('', 'popular')])
      .then(([character, worldLinks, worlds]) => {
        if (!mounted) return
        setItem(character.item)
        setLinks(worldLinks.items)
        setAvailableWorlds(worlds.items)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터를 불러오지 못했습니다.'))
    return () => { mounted = false }
  }, [slug])

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

  const worldPickerItems = availableWorlds.map((world) => {
    const linked = links.find((link) => link.worldSlug === world.slug)
    return {
      id: world.id,
      title: world.name,
      body: linked?.linkReason || world.headline || world.summary,
      value: world.slug,
    }
  })

  if (!item) {
    return <PageFrame chrome={chrome}><EmptyState title="캐릭터를 불러오는 중" description="잠시만 기다려주세요." /></PageFrame>
  }

  return (
    <PageFrame chrome={chrome}>
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
      <div className="grid gap-6 xl:grid-cols-[0.84fr_1.16fr]">
        <ArtworkFrame src={item.coverImageUrl} alt={item.name} aspectClassName="aspect-[3/4] xl:max-h-[720px]" priority />
        <div className="space-y-6 rounded-[2rem] border border-white/10 bg-[#20242b] p-6">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/42">캐릭터</p>
            <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.6rem)] font-semibold tracking-[-0.04em] text-white">{item.name}</h1>
            <p className="mt-3 text-base leading-8 text-white/64">{item.summary}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {item.tags.map((tag) => <span key={tag} className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/72">{tag}</span>)}
          </div>

          {item.imageSlots.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {item.imageSlots.slice(0, 6).map((slot) => (
                <div key={slot.id} className="w-[84px]">
                  <ArtworkFrame src={slot.cardUrl || slot.detailUrl || item.coverImageUrl} alt={`${item.name} ${slot.slot}`} aspectClassName="aspect-[3/4]" />
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
  const [availableCharacters, setAvailableCharacters] = useState<CharacterSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [aliasOpen, setAliasOpen] = useState(false)
  const [pendingCharacter, setPendingCharacter] = useState<CharacterSummary | null>(null)

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
      <div className="space-y-6">
        <ArtworkFrame src={item.coverImageUrl} alt={item.name} aspectClassName="aspect-[16/9]" priority />
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
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setPickerOpen(true)}><MessageCircle className="h-4 w-4" />캐릭터 선택 후 시작</Button>
            </div>
            <PageSection title="월드 정보" className="bg-white/[0.03]">
              <div className="grid gap-3 md:grid-cols-2">
                {item.worldSections.map((section) => <LinkCard key={section.title} title={section.title} body={section.body} />)}
              </div>
            </PageSection>
          </div>
        </div>
      </div>
    </PageFrame>
  )
}

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
    return selected?.detailUrl || room.character.coverImageUrl
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

  return (
    <PageFrame chrome={chrome}>
      {!room ? (
        <EmptyState title="대화를 불러오는 중" description="최근 장면과 상태를 정리하고 있습니다." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-4">
            {room.world ? (
              <ArtworkFrame src={activeWorldImage} alt={room.world.name} aspectClassName="aspect-[16/9]" priority />
            ) : null}
            <ArtworkFrame src={activeCharacterImage} alt={room.character.name} aspectClassName="aspect-[3/4]" priority />
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
  <div className="grid gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4 md:grid-cols-[220px_minmax(0,1fr)]">
    <ArtworkFrame src={previewUrl} alt={previewAlt} aspectClassName={aspectClassName} />

    <div className="flex flex-col justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-2 text-sm leading-6 text-white/56">{description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold tracking-[-0.015em] transition ${
            isProcessing ? 'pointer-events-none bg-white/8 text-white/48' : 'bg-white text-[#111317] hover:bg-white/92'
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
        <span className="text-xs leading-6 text-white/52">{hint}</span>
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
    thumbUrl: findVariant('thumb'),
    cardUrl: findVariant('card'),
    detailUrl: findVariant('detail') || findVariant('hero'),
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
  <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-white/68">
    <p className="font-semibold text-white">{title}</p>
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
          <p className="text-sm font-semibold text-white">상황별 이미지 추가</p>
          <p className="mt-1 text-sm leading-6 text-white/56">장면이 바뀔 때 어떤 이미지로 전환할지 슬롯별로 지정합니다.</p>
        </div>
        <Button variant="outline" onClick={onAdd}>
          <ImagePlus className="h-4 w-4" />상황별 이미지 추가
        </Button>
      </div>

      {slots.slice(1).map((slot) => (
        <div key={slot.id} className="grid gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-3">
            <ArtworkFrame src={slot.previewUrl} alt={`${slot.slot || '상황별'} 이미지 미리보기`} aspectClassName={aspectClassName} />
            <label className={`inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold tracking-[-0.015em] transition ${processingSlotId === slot.id ? 'pointer-events-none bg-white/8 text-white/48' : 'bg-white text-[#111317] hover:bg-white/92'}`}>
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
            <p className="text-xs leading-6 text-white/52">현재 원본 {slot.sourceSize || '미선택'} · 이 슬롯에 이미지를 올려야 AI가 선택할 수 있습니다.</p>
          </div>

          <div className="grid min-w-0 gap-4">
            <Input
              value={slot.slot}
              onChange={(event) => onUpdate(slot.id, { slot: event.target.value, usage: event.target.value })}
              placeholder="이미지 이름 (예: battle, rain, night)"
              className="bg-white/5 text-white placeholder:text-white/35"
            />
            <textarea
              value={slot.trigger}
              onChange={(event) => onUpdate(slot.id, { trigger: event.target.value })}
              placeholder="언제 이 이미지를 써야 하는지 아주 구체적으로 적어주세요. 예) 말싸움이 격해지거나 긴장감이 급상승할 때"
              className="min-h-[140px] w-full rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
            />
            <div className="flex justify-end">
              <Button variant="outline" className="border-[#d92c63]/40 text-[#ff8ab2] hover:bg-[#d92c63]/10 hover:text-white" onClick={() => onRemove(slot.id)}>
                <Trash2 className="h-4 w-4" />슬롯 삭제
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const selectStyle = { colorScheme: 'dark' as const }

export function CreateCharacterPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [tags, setTags] = useState('')
  const [sourceType, setSourceType] = useState<'original' | 'derivative'>('original')
  const [characterPrompt, setCharacterPrompt] = useState('')
  const [characterIntro, setCharacterIntro] = useState('')
  const [processingSlotId, setProcessingSlotId] = useState<string | null>(null)
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

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인 후 캐릭터를 만들 수 있습니다" description="만든 캐릭터는 바로 홈/상세/최근 대화 흐름에 연결됩니다." />
  }

  const derivedSummary = deriveSummaryFromPrompt(headline, characterPrompt)

  return (
    <PageFrame chrome={chrome}>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageSection title="기본 정보">
          <div className="grid gap-4">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="캐릭터 이름" className="bg-white/5 text-white placeholder:text-white/35" />
            <Input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="한 줄 소개" className="bg-white/5 text-white placeholder:text-white/35" />
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="태그 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
            <div className="rounded-[1.2rem] border border-[#62d0ff]/20 bg-[#62d0ff]/10 px-4 py-3 text-sm text-white/78">
              기본 저장값은 <span className="font-semibold text-white">전체 공개</span>입니다.
            </div>
            <label className="space-y-2 text-sm text-white/62">
              <span>원작 여부</span>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="h-12 w-full rounded-[1rem] border border-white/10 bg-[#15181d] px-4 text-white outline-none" style={selectStyle}>
                <option className="bg-[#15181d] text-white" value="original">오리지널</option>
                <option className="bg-[#15181d] text-white" value="derivative">2차창작</option>
              </select>
            </label>
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
              className="min-h-[360px] w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35"
            />
          </div>
        </PageSection>

        <PageSection title="캐릭터 도입부">
          <div className="space-y-3">
            <p className="text-sm leading-6 text-white/62">처음 방을 열었을 때 캐릭터가 어떤 태도와 온도로 등장해야 하는지 짧고 명확하게 적어주세요.</p>
            <textarea
              value={characterIntro}
              onChange={(event) => setCharacterIntro(event.target.value)}
              placeholder="예) 사용자를 한 번 살핀 뒤 짧게 먼저 말을 건다. 경계는 있지만 무례하지 않고, 호기심이 먼저 보인다."
              className="min-h-[120px] w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35"
            />
          </div>
        </PageSection>

        <PageSection title="캐릭터 이미지">
          <div className="rounded-[1.3rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/68">
            권장 3:4 · 최소 768×1024 · 세로형 인물 이미지를 권장하며, 업로드 이미지는 서비스용으로 WebP 변환을 권장합니다.
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

        <div className="flex justify-end">
          <Button disabled={processingSlotId !== null || !name.trim() || !headline.trim() || !characterPrompt.trim() || mainSlot.assets.length === 0} onClick={() => {
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
              const { item } = await platformApi.createCharacter({
                name,
                headline,
                summary: derivedSummary,
                tags: splitCommaValues(tags),
                visibility: 'public',
                sourceType,
                creatorName,
                coverImageUrl: detailUrl,
                avatarImageUrl: cardUrl,
                assets: mainAssets,
                profileJson: {
                  prompt: characterPrompt,
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
                },
              })
              toast.success('캐릭터를 만들었습니다.')
              chrome.onNavigate(`/characters/${item.slug}`)
            })().catch((error) => toast.error(error instanceof Error ? error.message : '캐릭터 생성에 실패했습니다.'))
          }}><PlusCircle className="h-4 w-4" />{processingSlotId ? '이미지 처리 중...' : '캐릭터 저장'}</Button>
        </div>
      </div>
    </PageFrame>
  )
}

export function CreateWorldPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [tags, setTags] = useState('')
  const [sourceType, setSourceType] = useState<'original' | 'derivative'>('original')
  const [worldPrompt, setWorldPrompt] = useState('')
  const [worldIntro, setWorldIntro] = useState('')
  const [processingSlotId, setProcessingSlotId] = useState<string | null>(null)
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

  return (
    <PageFrame chrome={chrome}>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageSection title="기본 정보">
          <div className="grid gap-4">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="월드 이름" className="bg-white/5 text-white placeholder:text-white/35" />
            <Input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="한 줄 설명" className="bg-white/5 text-white placeholder:text-white/35" />
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="태그 (쉼표로 구분)" className="bg-white/5 text-white placeholder:text-white/35" />
            <div className="rounded-[1.2rem] border border-[#62d0ff]/20 bg-[#62d0ff]/10 px-4 py-3 text-sm text-white/78">
              기본 저장값은 <span className="font-semibold text-white">전체 공개</span>입니다.
            </div>
            <label className="space-y-2 text-sm text-white/62">
              <span>원작 여부</span>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="h-12 w-full rounded-[1rem] border border-white/10 bg-[#15181d] px-4 text-white outline-none" style={selectStyle}>
                <option className="bg-[#15181d] text-white" value="original">오리지널</option>
                <option className="bg-[#15181d] text-white" value="derivative">2차창작</option>
              </select>
            </label>
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
              className="min-h-[360px] w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35"
            />
          </div>
        </PageSection>

        <PageSection title="월드 도입부">
          <div className="space-y-3">
            <p className="text-sm leading-6 text-white/62">사용자가 이 월드에 들어왔을 때 기본적으로 어떤 장소, 어떤 압력, 어떤 장면으로 시작해야 하는지 간결하게 적어주세요.</p>
            <textarea
              value={worldIntro}
              onChange={(event) => setWorldIntro(event.target.value)}
              placeholder="예) 비가 막 그친 편의점 앞에서 시작한다. 막차가 얼마 남지 않아 시간이 촉박하고, 주변 공기는 조용하지만 눅눅한 긴장감이 있다."
              className="min-h-[120px] w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-[15px] leading-7 text-white outline-none placeholder:text-white/35"
            />
          </div>
        </PageSection>

        <PageSection title="월드 이미지">
          <div className="rounded-[1.3rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/68">
            권장 16:9 · 최소 1280×720 · 가로형 배경/공간 이미지를 권장하며, 업로드 이미지는 서비스용으로 WebP 변환을 권장합니다.
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

        <div className="flex justify-end">
          <Button disabled={processingSlotId !== null || !name.trim() || !headline.trim() || !worldPrompt.trim() || mainSlot.assets.length === 0} onClick={() => {
            void (async () => {
              const slotAssets = imageSlots.flatMap((slot) => slot.assets)
              const uploadedAssets = slotAssets.length > 0
                ? await uploadPreparedAssets({ entityType: 'world', assets: slotAssets })
                : []
              const imageSlotRecords = imageSlots.map((slot) => buildSlotRecord({ slot, uploadedAssets }))
              const mainRecord = imageSlotRecords[0]
              const heroUrl = mainRecord?.detailUrl || uploadedAssets.find((asset) => asset.kind === `${mainSlot.id}:hero`)?.url || ''
              const { item } = await platformApi.createWorld({
                name,
                headline,
                summary: derivedSummary,
                tags: splitCommaValues(tags),
                visibility: 'public',
                sourceType,
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
                },
              })
              toast.success('월드를 만들었습니다.')
              chrome.onNavigate(`/worlds/${item.slug}`)
            })().catch((error) => toast.error(error instanceof Error ? error.message : '월드 생성에 실패했습니다.'))
          }}><PlusCircle className="h-4 w-4" />{processingSlotId ? '이미지 처리 중...' : '월드 저장'}</Button>
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
            {items.map((room) => (
              <button key={room.id} type="button" onClick={() => chrome.onNavigate(`/rooms/${room.id}`)} className="w-full rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/18 hover:bg-white/7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${room.world ? 'bg-[#62d0ff]/15 text-[#9de7ff]' : 'bg-[#d98cff]/15 text-[#f0c4ff]'}`}>{room.world ? '월드 결합' : '직접 대화'}</span>
                  <span className="text-xs text-white/44">{room.character.name}{room.world ? ` · ${room.world.name}` : ''}</span>
                </div>
                <p className="mt-3 text-lg font-semibold text-white">{room.title}</p>
                <p className="mt-2 text-sm font-semibold text-white/70">마지막 장면</p>
                <p className="mt-1 text-sm leading-6 text-white/62">{room.state.currentSituation}</p>
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

          <PageSection title="내가 만든 캐릭터">
            {library.owned.characters.length === 0 ? <EmptyState title="아직 만든 캐릭터가 없습니다" description="캐릭터 만들기에서 첫 캐릭터를 등록해보세요." /> : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {library.owned.characters.map((item) => <EntityCard key={item.id} item={item} onClick={() => chrome.onNavigate(`/characters/${item.slug}`)} />)}
              </div>
            )}
          </PageSection>

          <PageSection title="내가 만든 월드">
            {library.owned.worlds.length === 0 ? <EmptyState title="아직 만든 월드가 없습니다" description="월드 만들기에서 첫 월드를 등록해보세요." /> : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {library.owned.worlds.map((item) => <EntityCard key={item.id} item={item} onClick={() => chrome.onNavigate(`/worlds/${item.slug}`)} />)}
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
