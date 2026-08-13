import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ImagePlus, Loader2, PlusCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { platformApi } from '@/lib/platform/apiClient'
import { CHARACTER_VARIANTS, createImageVariants, type ResizedImageAsset, WORLD_VARIANTS } from '@/lib/platform/imagePipeline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArtworkFrame, EmptyState, LoadingState, NavigationLink, PageSection } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'
import { imageProcessingFailureMessage, OwnedContentDeleteDialog, PageFrame, ProtectedGate, safeActionError } from '@/components/platform/shared/PageFrame'
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
        <span className="text-xs leading-6 text-[#666]">{hint}</span>
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

interface EditorMutationSnapshot {
  draftKey: string
  draftRevision: string | null
  mutationRevision: number
}

interface EditorIntegrityState {
  scope: string
  isDirty: boolean
  imageSlotsDirty: boolean
  mutationRevision: number
}

type EditorIntegrityAction =
  | { type: 'scope'; scope: string }
  | { type: 'dirty'; imageSlots?: boolean }
  | { type: 'clean' }
  | { type: 'setImageSlotsDirty'; value: boolean }

const reduceEditorIntegrity = (state: EditorIntegrityState, action: EditorIntegrityAction): EditorIntegrityState => {
  switch (action.type) {
    case 'scope':
      return state.scope === action.scope
        ? state
        : { scope: action.scope, isDirty: false, imageSlotsDirty: false, mutationRevision: state.mutationRevision + 1 }
    case 'dirty':
      return {
        ...state,
        isDirty: true,
        imageSlotsDirty: action.imageSlots ? true : state.imageSlotsDirty,
        mutationRevision: state.mutationRevision + 1,
      }
    case 'clean':
      return { ...state, isDirty: false, mutationRevision: state.mutationRevision + 1 }
    case 'setImageSlotsDirty':
      return { ...state, imageSlotsDirty: action.value }
  }
}

const useEditorIntegrity = (chrome: PlatformPageChromeProps, draftKey: string) => {
  const [state, dispatch] = useReducer(reduceEditorIntegrity, {
    scope: draftKey,
    isDirty: false,
    imageSlotsDirty: false,
    mutationRevision: 0,
  })
  const stateRef = useRef(state)
  const isDirtyRef = useRef(false)
  const isMountedRef = useRef(false)
  const activeDraftKeyRef = useRef(draftKey)
  const chromeRef = useRef(chrome)
  stateRef.current = state
  activeDraftKeyRef.current = draftKey
  chromeRef.current = chrome

  const transition = (action: EditorIntegrityAction) => {
    stateRef.current = reduceEditorIntegrity(stateRef.current, action)
    dispatch(action)
  }

  const markDirty = () => {
    isDirtyRef.current = true
    transition({ type: 'dirty' })
    chromeRef.current.onEditorDirtyChange?.(true)
  }

  const markImageSlotsDirty = () => {
    isDirtyRef.current = true
    transition({ type: 'dirty', imageSlots: true })
    chromeRef.current.onEditorDirtyChange?.(true)
  }

  const markClean = () => {
    isDirtyRef.current = false
    transition({ type: 'clean' })
    chromeRef.current.onEditorDirtyChange?.(false)
  }

  const captureNavigation = (): EditorMutationSnapshot => ({
    draftKey: activeDraftKeyRef.current,
    draftRevision: activeDraftKeyRef.current ? readEditorDraftRevision(activeDraftKeyRef.current) : null,
    mutationRevision: stateRef.current.mutationRevision,
  })

  const finishAndNavigate = (path: string, snapshot: EditorMutationSnapshot) => {
    const navigationIsCurrent = isMountedRef.current
      && activeDraftKeyRef.current === snapshot.draftKey
      && stateRef.current.mutationRevision === snapshot.mutationRevision
    const submittedDraftStillStored = Boolean(snapshot.draftKey)
      && snapshot.draftRevision !== null
      && readEditorDraftRevision(snapshot.draftKey) === snapshot.draftRevision
    if (snapshot.draftKey && submittedDraftStillStored) {
      clearEditorDraft(snapshot.draftKey)
    }
    if (!navigationIsCurrent) return
    markClean()
    chromeRef.current.onNavigate(path)
  }

  useEffect(() => {
    isDirtyRef.current = false
    transition({ type: 'scope', scope: draftKey })
    chromeRef.current.onEditorDirtyChange?.(false)
  }, [draftKey])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      chromeRef.current.onEditorDirtyChange?.(false)
    }
  }, [])

  return {
    editorChrome: chrome,
    editorNavigationDialog: null,
    captureNavigation,
    finishAndNavigate,
    guardedNavigate: chrome.onNavigate,
    imageSlotsDirty: state.imageSlotsDirty,
    isDirty: state.isDirty,
    markClean,
    markDirty,
    markImageSlotsDirty,
    setImageSlotsDirty: (value: boolean) => transition({ type: 'setImageSlotsDirty', value }),
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
            <p className="text-xs leading-6 text-[#666]">현재 원본 {slot.sourceSize || '미선택'} · 이미지를 올리면 이 슬롯을 사용할 수 있습니다.</p>
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
