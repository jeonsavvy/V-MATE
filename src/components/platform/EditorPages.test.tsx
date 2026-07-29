import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateCharacterPage, CreateWorldPage } from '@/components/platform/Pages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

const api = vi.hoisted(() => ({
  fetchCharacter: vi.fn(),
  updateCharacter: vi.fn(),
  createCharacter: vi.fn(),
  deleteCharacter: vi.fn(),
  fetchWorld: vi.fn(),
  updateWorld: vi.fn(),
  createWorld: vi.fn(),
  deleteWorld: vi.fn(),
  prepareUploads: vi.fn(),
}))

const imagePipeline = vi.hoisted(() => ({
  createImageVariants: vi.fn(),
}))

const storage = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(),
}))

vi.mock('@/lib/platform/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform/apiClient')>()),
  platformApi: api,
}))

vi.mock('@/lib/platform/imagePipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform/imagePipeline')>()),
  createImageVariants: imagePipeline.createImageVariants,
}))

vi.mock('@/lib/supabase', () => ({
  resolveSupabaseClient: async () => ({
    storage: {
      from: () => ({ uploadToSignedUrl: storage.uploadToSignedUrl }),
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const chrome: PlatformPageChromeProps = {
  user: { id: 'user-1', email: 'user@example.com', user_metadata: { name: '사용자' } } as unknown as PlatformPageChromeProps['user'],
  authStatus: 'authenticated',
  userAvatarInitial: '사',
  searchQuery: '',
  onSearchChange: vi.fn(),
  onSearchSubmit: vi.fn(),
  onNavigate: vi.fn(),
  onAuthRequest: vi.fn(),
  onSignOut: vi.fn(),
  onDeleteAccount: vi.fn(async () => undefined),
  selectedCharacter: null,
  selectedWorld: null,
  isStartingCombination: false,
  onSelectEntity: vi.fn(),
  onClearSelectedEntity: vi.fn(),
  onStartCombination: vi.fn(async () => undefined),
}

const existingCharacter = {
  id: 'character-1',
  entityType: 'character',
  slug: 'character-1',
  name: '기존 캐릭터',
  headline: '기존 한 줄 소개',
  summary: '기존 설정',
  tags: ['테스트'],
  creator: { id: 'user-1', slug: 'user-1', name: '사용자' },
  visibility: 'private',
  displayStatus: 'visible',
  sourceType: 'original',
  sourceUrl: '',
  rightsAttestedAt: null,
  favoriteCount: 0,
  chatStartCount: 0,
  updatedAt: '2026-07-29T00:00:00.000Z',
  coverImageUrl: 'https://example.com/main-detail.webp',
  avatarImageUrl: 'https://example.com/main-card.webp',
  promptProfileJson: { masterPrompt: '기존 상세 설정', characterIntro: '' },
  imageSlots: [
    { id: 'main', slot: 'main', usage: '대표', trigger: '기본', priority: 100, thumbUrl: 'https://example.com/main-thumb.webp', cardUrl: 'https://example.com/main-card.webp', detailUrl: 'https://example.com/main-detail.webp' },
    { id: 'night', slot: 'night', usage: '밤', trigger: '밤 장면', priority: 80, thumbUrl: 'https://example.com/night-thumb.webp', cardUrl: 'https://example.com/night-card.webp', detailUrl: 'https://example.com/night-detail.webp' },
  ],
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState({}, '', '/create/character')
  vi.clearAllMocks()
  api.prepareUploads.mockImplementation(async ({ variants }: { variants: Array<{ kind: string; width: number; height: number }> }) => ({
    bucket: 'entity-images',
    expiresAt: '2026-07-29T01:00:00.000Z',
    uploads: variants.map((variant) => ({
      ...variant,
      path: `${variant.kind}.webp`,
      token: `token-${variant.kind}`,
      signedUrl: `https://example.com/upload/${variant.kind}`,
      publicUrl: `https://example.com/public/${variant.kind}.webp`,
      bucket: 'entity-images',
    })),
  }))
  storage.uploadToSignedUrl.mockResolvedValue({ error: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('editor draft integrity', () => {
  it('guards internal character navigation, registers unload protection, and restores the session draft', async () => {
    const first = render(<CreateCharacterPage chrome={chrome} />)
    const nameInput = await screen.findByLabelText('이름 · 필수')
    fireEvent.change(nameInput, { target: { value: '임시 캐릭터' } })

    await waitFor(() => expect(Object.keys(window.sessionStorage).some((key) => key.startsWith('v-mate:editor-draft:v1:character:new:'))).toBe(true))
    fireEvent.click(screen.getByRole('link', { name: '캐릭터' }))
    expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경사항이 있습니다' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '월드' }))
    expect(await screen.findByRole('dialog', { name: '저장하지 않은 변경사항이 있습니다' })).toBeTruthy()
    expect(chrome.onNavigate).not.toHaveBeenCalled()
    expect((nameInput as HTMLInputElement).value).toBe('임시 캐릭터')

    fireEvent.click(screen.getByRole('button', { name: '계속 편집' }))
    expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경사항이 있습니다' })).toBeNull()
    expect((nameInput as HTMLInputElement).value).toBe('임시 캐릭터')

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: '월드' }))
    const leaveButton = await screen.findByRole('button', { name: '저장하지 않고 이동' })
    act(() => {
      fireEvent.click(leaveButton)
      fireEvent.click(leaveButton)
    })
    expect(chrome.onNavigate).toHaveBeenCalledTimes(1)
    expect(chrome.onNavigate).toHaveBeenCalledWith('/create/world')

    first.unmount()
    render(<CreateCharacterPage chrome={chrome} />)
    await waitFor(() => expect((screen.getByLabelText('이름 · 필수') as HTMLInputElement).value).toBe('임시 캐릭터'))
  })

  it('keeps search input and editor content on cancel, then submits the first target once', async () => {
    const searchChrome = { ...chrome, searchQuery: '별빛', onSearchSubmit: vi.fn() }
    render(<CreateCharacterPage chrome={searchChrome} />)
    const nameInput = await screen.findByLabelText('이름 · 필수')
    fireEvent.change(nameInput, { target: { value: '검색 전 임시 캐릭터' } })

    const searchForm = screen.getByRole('search')
    fireEvent.submit(searchForm)
    fireEvent.submit(searchForm)
    expect(await screen.findByText('검색 결과로 이동하면 현재 입력 내용은 임시저장본으로만 남습니다.')).toBeTruthy()
    expect(searchChrome.onSearchSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '계속 편집' }))
    expect((screen.getByRole('searchbox', { name: '캐릭터와 월드 검색' }) as HTMLInputElement).value).toBe('별빛')
    expect((nameInput as HTMLInputElement).value).toBe('검색 전 임시 캐릭터')

    fireEvent.submit(searchForm)
    fireEvent.submit(searchForm)
    const leaveButton = await screen.findByRole('button', { name: '저장하지 않고 이동' })
    act(() => {
      fireEvent.click(leaveButton)
      fireEvent.click(leaveButton)
    })
    expect(searchChrome.onSearchSubmit).toHaveBeenCalledTimes(1)
    expect(searchChrome.onSearchSubmit).toHaveBeenCalledWith('별빛')
  })

  it('restores a world draft independently from the character editor', async () => {
    const first = render(<CreateWorldPage chrome={chrome} />)
    fireEvent.change(await screen.findByLabelText('이름 · 필수'), { target: { value: '임시 월드' } })
    await waitFor(() => expect(Object.keys(window.sessionStorage).some((key) => key.startsWith('v-mate:editor-draft:v1:world:new:'))).toBe(true))

    first.unmount()
    render(<CreateWorldPage chrome={chrome} />)
    await waitFor(() => expect((screen.getByLabelText('이름 · 필수') as HTMLInputElement).value).toBe('임시 월드'))
  })

  it.each([
    {
      kind: 'character',
      path: '/create/character',
      renderEditor: () => render(<CreateCharacterPage chrome={chrome} />),
      slotName: '비 오는 골목',
      trigger: '비가 내리는 골목 장면일 때',
      expectedPriority: '90',
    },
    {
      kind: 'world',
      path: '/create/world',
      renderEditor: () => render(<CreateWorldPage chrome={chrome} />),
      slotName: '달빛 광장',
      trigger: '달빛 아래 광장으로 이동했을 때',
      expectedPriority: '90',
    },
  ])('restores a new $kind situation slot without persisting image binaries', async ({ kind, path, renderEditor, slotName, trigger, expectedPriority }) => {
    window.history.replaceState({}, '', path)
    const first = renderEditor()
    await screen.findByLabelText('이름 · 필수')
    fireEvent.click(screen.getByRole('button', { name: '상황별 이미지 추가' }))
    fireEvent.change(screen.getByLabelText('슬롯 이름'), { target: { value: slotName } })
    fireEvent.change(screen.getByLabelText('표시 조건'), { target: { value: trigger } })

    const draftKey = `v-mate:editor-draft:v1:${kind}:new:user-1`
    await waitFor(() => {
      const draft = JSON.parse(window.sessionStorage.getItem(draftKey) || '{}') as {
        imageSlots?: Array<Record<string, unknown>>
        requiresImageReselection?: boolean
      }
      expect(draft.imageSlots).toHaveLength(2)
      expect(draft.imageSlots?.[1]).toMatchObject({
        id: expect.any(String),
        slot: slotName,
        usage: slotName,
        trigger,
        priority: expectedPriority,
        existingThumbUrl: '',
        existingCardUrl: '',
        existingDetailUrl: '',
      })
      expect(draft.imageSlots?.[1]).not.toHaveProperty('assets')
      expect(draft.imageSlots?.[1]).not.toHaveProperty('previewUrl')
      expect(draft.requiresImageReselection).toBe(true)
    })

    first.unmount()
    renderEditor()

    expect(await screen.findByDisplayValue(slotName)).toBeTruthy()
    expect(screen.getByDisplayValue(trigger)).toBeTruthy()
  })

  it('never persists the previous user draft into the next user scope', async () => {
    const firstUserChrome = { ...chrome }
    const secondUserChrome = {
      ...chrome,
      user: { id: 'user-2', email: 'other@example.com', user_metadata: { name: '다른 사용자' } } as unknown as PlatformPageChromeProps['user'],
    }
    const view = render(<CreateCharacterPage chrome={firstUserChrome} />)
    fireEvent.change(await screen.findByLabelText('이름 · 필수'), { target: { value: '사용자 1 비공개 초안' } })
    await waitFor(() => expect(window.sessionStorage.getItem('v-mate:editor-draft:v1:character:new:user-1')).toContain('사용자 1 비공개 초안'))

    view.rerender(<CreateCharacterPage chrome={secondUserChrome} />)

    await waitFor(() => expect((screen.getByLabelText('이름 · 필수') as HTMLInputElement).value).toBe(''))
    expect(window.sessionStorage.getItem('v-mate:editor-draft:v1:character:new:user-2')).toBeNull()
  })

  it('does not restore the previous entity draft after an edit slug changes without remounting', async () => {
    api.fetchCharacter.mockImplementation(async (slug: string) => ({
      item: {
        ...existingCharacter,
        id: slug,
        slug,
        name: slug === 'character-1' ? '첫 캐릭터' : '둘째 캐릭터',
      },
    }))
    const view = render(<CreateCharacterPage chrome={chrome} slug="character-1" />)
    expect(await screen.findByDisplayValue('첫 캐릭터')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('이름 · 필수'), { target: { value: '첫 캐릭터 비공개 초안' } })
    await waitFor(() => expect(window.sessionStorage.getItem('v-mate:editor-draft:v1:character:character-1:user-1')).toContain('첫 캐릭터 비공개 초안'))

    view.rerender(<CreateCharacterPage chrome={chrome} slug="character-2" />)

    expect(await screen.findByDisplayValue('둘째 캐릭터')).toBeTruthy()
    expect(window.sessionStorage.getItem('v-mate:editor-draft:v1:character:character-2:user-1')).toBeNull()
  })

  it('keeps every file input and save action disabled until all concurrent image work settles', async () => {
    let resolveMain: ((assets: Array<Record<string, unknown>>) => void) | undefined
    let resolveNight: ((assets: Array<Record<string, unknown>>) => void) | undefined
    imagePipeline.createImageVariants
      .mockReturnValueOnce(new Promise((resolve) => { resolveMain = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNight = resolve }))
    api.fetchCharacter.mockResolvedValueOnce({ item: existingCharacter })
    const { container } = render(<CreateCharacterPage chrome={chrome} slug="character-1" />)
    expect(await screen.findByDisplayValue('기존 캐릭터')).toBeTruthy()
    const fileInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    const mainFile = new File(['main'], 'main.png', { type: 'image/png' })
    const nightFile = new File(['night'], 'night.png', { type: 'image/png' })
    Object.defineProperty(fileInputs[0], 'files', { configurable: true, value: [mainFile] })
    Object.defineProperty(fileInputs[1], 'files', { configurable: true, value: [nightFile] })

    act(() => {
      fileInputs[0].dispatchEvent(new Event('change', { bubbles: true }))
      fileInputs[1].dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(imagePipeline.createImageVariants).toHaveBeenCalledTimes(2)
    await waitFor(() => fileInputs.forEach((input) => expect(input.disabled).toBe(true)))
    resolveMain?.([{ kind: 'main:detail', width: 20, height: 20, dataUrl: 'data:image/webp;base64,bWFpbg==', sourceWidth: 20, sourceHeight: 20 }])
    await act(async () => { await Promise.resolve() })
    fileInputs.forEach((input) => expect(input.disabled).toBe(true))
    expect((screen.getByRole('button', { name: '이미지 처리 중…' }) as HTMLButtonElement).disabled).toBe(true)

    resolveNight?.([{ kind: 'night:detail', width: 20, height: 20, dataUrl: 'data:image/webp;base64,bmlnaHQ=', sourceWidth: 20, sourceHeight: 20 }])
    await waitFor(() => fileInputs.forEach((input) => expect(input.disabled).toBe(false)))
  })

  it.each([
    { kind: 'character', path: '/create/character', renderEditor: () => render(<CreateCharacterPage chrome={chrome} />), leaveFor: '월드' },
    { kind: 'world', path: '/create/world', renderEditor: () => render(<CreateWorldPage chrome={chrome} />), leaveFor: '캐릭터' },
  ])('guards $kind navigation as soon as image processing begins', async ({ kind, path, renderEditor, leaveFor }) => {
    window.history.replaceState({}, '', path)
    imagePipeline.createImageVariants.mockReturnValueOnce(new Promise(() => undefined))
    const { container } = renderEditor()
    await screen.findByLabelText('이름 · 필수')
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['pending-image'], `${kind}.png`, { type: 'image/png' })
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] })

    act(() => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    fireEvent.click(screen.getByRole('link', { name: leaveFor }))

    expect(await screen.findByRole('dialog', { name: '저장하지 않은 변경사항이 있습니다' })).toBeTruthy()
    expect(chrome.onNavigate).not.toHaveBeenCalled()
    await waitFor(() => {
      const draftKey = Object.keys(window.sessionStorage).find((key) => key.startsWith(`v-mate:editor-draft:v1:${kind}:new:`))
      expect(draftKey).toBeTruthy()
      expect(JSON.parse(window.sessionStorage.getItem(draftKey!) || '{}').requiresImageReselection).toBe(true)
    })
  })

  it('clears an unchanged submitted draft without redirecting after an approved leave', async () => {
    let resolveUpdate: ((value: { item: typeof existingCharacter }) => void) | undefined
    api.fetchCharacter.mockResolvedValueOnce({ item: existingCharacter })
    api.updateCharacter.mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve }))
    render(<CreateCharacterPage chrome={chrome} slug="character-1" />)
    expect(await screen.findByDisplayValue('기존 캐릭터')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('이름 · 필수'), { target: { value: '저장 중인 캐릭터' } })
    fireEvent.click(screen.getByRole('button', { name: '캐릭터 수정' }))
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1))
    expect((screen.getByLabelText('이름 · 필수') as HTMLInputElement).matches(':disabled')).toBe(true)
    const draftKey = 'v-mate:editor-draft:v1:character:character-1:user-1'
    await waitFor(() => expect(window.sessionStorage.getItem(draftKey)).toContain('저장 중인 캐릭터'))

    fireEvent.click(screen.getByRole('link', { name: '월드' }))
    fireEvent.click(await screen.findByRole('button', { name: '저장하지 않고 이동' }))
    expect(chrome.onNavigate).toHaveBeenCalledTimes(1)

    resolveUpdate?.({ item: existingCharacter })
    await waitFor(() => expect((screen.getByRole('button', { name: '캐릭터 수정' }) as HTMLButtonElement).disabled).toBe(false))
    expect(chrome.onNavigate).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(draftKey)).toBeNull()
  })

  it('does not let an older successful save delete a newer draft for the same editor', async () => {
    let resolveUpdate: ((value: { item: typeof existingCharacter }) => void) | undefined
    api.fetchCharacter
      .mockResolvedValueOnce({ item: existingCharacter })
      .mockResolvedValueOnce({ item: existingCharacter })
    api.updateCharacter.mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve }))
    const first = render(<CreateCharacterPage chrome={chrome} slug="character-1" />)
    expect(await screen.findByDisplayValue('기존 캐릭터')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('이름 · 필수'), { target: { value: '먼저 저장한 값' } })
    const draftKey = 'v-mate:editor-draft:v1:character:character-1:user-1'
    await waitFor(() => expect(window.sessionStorage.getItem(draftKey)).toContain('먼저 저장한 값'))
    fireEvent.click(screen.getByRole('button', { name: '캐릭터 수정' }))
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('link', { name: '월드' }))
    fireEvent.click(await screen.findByRole('button', { name: '저장하지 않고 이동' }))
    first.unmount()

    render(<CreateCharacterPage chrome={chrome} slug="character-1" />)
    expect(await screen.findByDisplayValue('먼저 저장한 값')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('이름 · 필수'), { target: { value: '나중에 다시 편집한 값' } })
    await waitFor(() => expect(window.sessionStorage.getItem(draftKey)).toContain('나중에 다시 편집한 값'))

    resolveUpdate?.({ item: existingCharacter })
    await act(async () => { await Promise.resolve() })
    expect(window.sessionStorage.getItem(draftKey)).toContain('나중에 다시 편집한 값')
  })

  it('does not let an older image save delete a draft after a different image is reselected', async () => {
    let resolveUpdate: ((value: { item: typeof existingCharacter }) => void) | undefined
    let updatePromise: Promise<{ item: typeof existingCharacter }>
    api.fetchCharacter
      .mockResolvedValueOnce({ item: existingCharacter })
      .mockResolvedValueOnce({ item: existingCharacter })
    api.updateCharacter.mockReturnValueOnce(updatePromise = new Promise((resolve) => { resolveUpdate = resolve }))
    imagePipeline.createImageVariants
      .mockResolvedValueOnce([{ kind: 'main:detail', width: 20, height: 20, dataUrl: 'data:image/webp;base64,QQ==', sourceWidth: 20, sourceHeight: 20 }])
      .mockResolvedValueOnce([{ kind: 'main:detail', width: 20, height: 20, dataUrl: 'data:image/webp;base64,Qg==', sourceWidth: 20, sourceHeight: 20 }])

    const draftKey = 'v-mate:editor-draft:v1:character:character-1:user-1'
    const selectFile = (input: HTMLInputElement, file: File) => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const readDraft = () => JSON.parse(window.sessionStorage.getItem(draftKey) || '{}') as Record<string, unknown>
    const draftContent = (draft: Record<string, unknown>) => Object.fromEntries(
      Object.entries(draft).filter(([key]) => key !== 'revision' && key !== 'updatedAt'),
    )

    const first = render(<CreateCharacterPage chrome={chrome} slug="character-1" />)
    expect(await screen.findByDisplayValue('기존 캐릭터')).toBeTruthy()
    act(() => selectFile(first.container.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['image-a'], 'a.png', { type: 'image/png' })))
    await waitFor(() => expect(imagePipeline.createImageVariants).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('button', { name: '캐릭터 수정' }) as HTMLButtonElement).disabled).toBe(false))
    await waitFor(() => expect(readDraft().requiresImageReselection).toBe(true))
    const submittedDraft = readDraft()
    expect(typeof submittedDraft.revision).toBe('string')

    fireEvent.click(screen.getByRole('button', { name: '캐릭터 수정' }))
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '월드' }))
    fireEvent.click(await screen.findByRole('button', { name: '저장하지 않고 이동' }))
    first.unmount()

    const second = render(<CreateCharacterPage chrome={chrome} slug="character-1" />)
    expect(await screen.findByDisplayValue('기존 캐릭터')).toBeTruthy()
    await waitFor(() => expect(readDraft().revision).not.toBe(submittedDraft.revision))
    const restoredRevision = readDraft().revision
    act(() => selectFile(second.container.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['image-b'], 'b.png', { type: 'image/png' })))
    await waitFor(() => expect(imagePipeline.createImageVariants).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((screen.getByRole('button', { name: '캐릭터 수정' }) as HTMLButtonElement).disabled).toBe(false))
    await waitFor(() => expect(readDraft().revision).not.toBe(restoredRevision))
    const newerImageDraft = readDraft()
    expect(draftContent(newerImageDraft)).toEqual(draftContent(submittedDraft))

    await act(async () => {
      resolveUpdate?.({ item: existingCharacter })
      await updatePromise
      await Promise.resolve()
    })

    expect(readDraft().revision).toBe(newerImageDraft.revision)
    expect(window.sessionStorage.getItem(draftKey)).not.toBeNull()
  })

  it('does not redirect after a delete resolves in a newer app navigation generation', async () => {
    let resolveDelete: (() => void) | undefined
    let appGeneration = 0
    const generationChrome = { ...chrome, getNavigationGeneration: () => appGeneration }
    api.fetchCharacter.mockResolvedValueOnce({ item: existingCharacter })
    api.deleteCharacter.mockReturnValueOnce(new Promise<void>((resolve) => { resolveDelete = resolve }))
    render(<CreateCharacterPage chrome={generationChrome} slug="character-1" />)
    expect(await screen.findByDisplayValue('기존 캐릭터')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '캐릭터 삭제' }))
    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
    await waitFor(() => expect(api.deleteCharacter).toHaveBeenCalledTimes(1))

    appGeneration = 1
    resolveDelete?.()
    await waitFor(() => expect(screen.queryByRole('button', { name: '삭제' })).toBeNull())
    expect(generationChrome.onNavigate).not.toHaveBeenCalled()
  })

  it('sends edited existing image-slot metadata without pretending there was a new upload', async () => {
    api.fetchCharacter.mockResolvedValueOnce({ item: existingCharacter })
    api.updateCharacter.mockResolvedValueOnce({ item: existingCharacter })
    render(<CreateCharacterPage chrome={chrome} slug="character-1" />)

    expect(await screen.findByDisplayValue('기존 캐릭터')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('슬롯 이름'), { target: { value: 'midnight' } })
    fireEvent.click(screen.getByRole('button', { name: '캐릭터 수정' }))

    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1))
    const payload = api.updateCharacter.mock.calls[0][1] as { assets?: unknown[]; promptProfileJson: { imageSlots?: Array<{ slot: string }> } }
    expect(Object.prototype.hasOwnProperty.call(payload, 'assets')).toBe(false)
    expect(payload.promptProfileJson.imageSlots?.map((slot) => slot.slot)).toContain('midnight')
  })
})
