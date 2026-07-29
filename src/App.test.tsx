import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { getStoredKeys, removeStoredItem, setStoredItem } from '@/lib/browserStorage'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

type HomeProps = {
  authStatus: 'checking' | 'authenticated' | 'anonymous' | 'unavailable'
  onAuthRequest: () => void
  onNavigate: (path: string) => void
  searchQuery: string
  selectedCharacter: { name: string } | null
}

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ devError: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  resolveSupabaseClient: async () => ({
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: auth.unsubscribe } } })),
    },
  }),
}))

vi.mock('@/components/Home', () => ({
  Home: ({ authStatus, onAuthRequest, onNavigate, searchQuery, selectedCharacter }: HomeProps) => (
    <main>
      <p>인증 상태: {authStatus}</p>
      <p>검색어: {searchQuery}</p>
      <p>선택 캐릭터: {selectedCharacter?.name || '없음'}</p>
      <button type="button" onClick={onAuthRequest}>{authStatus === 'unavailable' ? '인증 다시 확인' : '로그인'}</button>
      <button type="button" onClick={() => onNavigate('/create/character')}>캐릭터 편집기 열기</button>
      <button type="button" onClick={() => onNavigate('/')}>홈으로 이동</button>
    </main>
  ),
}))

vi.mock('@/components/AuthDialog', () => ({ AuthDialog: () => null }))

vi.mock('@/components/platform/Pages', () => {
  const Placeholder = () => <main>대체 화면</main>
  const CreateCharacterPage = ({ chrome, slug }: { chrome: PlatformPageChromeProps; slug?: string }) => {
    const [localValue, setLocalValue] = useState('')
    return (
      <main>
        <p>가짜 캐릭터 편집기</p>
        <p>편집 대상: {slug || 'new'}</p>
        <label>로컬 편집값<input aria-label="로컬 편집값" value={localValue} onChange={(event) => setLocalValue(event.target.value)} /></label>
        <button type="button" onClick={() => chrome.onEditorDirtyChange?.(true)}>편집 내용 변경</button>
        <button type="button" onClick={() => chrome.onNavigate('/privacy')}>개인정보로 이동</button>
        <button type="button" onClick={() => chrome.onNavigate('/edit/character/character-b')}>다른 캐릭터 편집</button>
      </main>
    )
  }
  return {
    CharacterDetailPage: Placeholder,
    WorldDetailPage: Placeholder,
    StartCharacterPage: Placeholder,
    StartWorldPage: Placeholder,
    RoomPage: Placeholder,
    CreateCharacterPage,
    CreateWorldPage: Placeholder,
    RecentRoomsPage: Placeholder,
    LibraryPage: Placeholder,
    OpsPage: Placeholder,
  }
})

beforeEach(() => {
  getStoredKeys().forEach((key) => removeStoredItem(key))
  window.sessionStorage.clear()
  window.history.replaceState({}, '', '/')
  auth.getSession.mockReset()
  auth.unsubscribe.mockReset()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('App authentication recovery', () => {
  it('reinitializes the auth session after an unavailable state instead of remaining checking', async () => {
    auth.getSession
      .mockRejectedValueOnce(new Error('temporary session failure'))
      .mockResolvedValueOnce({ data: { session: null } })
    const user = userEvent.setup()

    render(<App />)
    await user.click(await screen.findByRole('button', { name: '로그인' }))

    expect(await screen.findByText('인증 상태: unavailable')).toBeTruthy()
    expect(auth.getSession).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '인증 다시 확인' }))

    await waitFor(() => expect(auth.getSession).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('인증 상태: anonymous')).toBeTruthy()
  })

  it('waits for auth hydration before restoring and persisting a private combination selection', async () => {
    setStoredItem('sb-v-mate-auth-token', '{}')
    const privateCharacter = {
      id: 'private-character',
      entityType: 'character',
      slug: 'private-character',
      name: '비공개 캐릭터',
      visibility: 'private',
    }
    window.sessionStorage.setItem('v-mate:combination-selection:v1', JSON.stringify({
      character: privateCharacter,
      world: null,
      userId: 'user-1',
      privateOwnerUserId: 'user-1',
    }))
    let resolveSession: ((value: { data: { session: { user: { id: string; email: string; user_metadata: Record<string, unknown> } } } }) => void) | undefined
    auth.getSession.mockReturnValueOnce(new Promise((resolve) => { resolveSession = resolve }))

    render(<App />)
    expect(await screen.findByText('인증 상태: checking')).toBeTruthy()
    expect(JSON.parse(window.sessionStorage.getItem('v-mate:combination-selection:v1') || '{}').character?.name).toBe('비공개 캐릭터')

    resolveSession?.({ data: { session: { user: { id: 'user-1', email: 'user@example.com', user_metadata: {} } } } })

    expect(await screen.findByText('선택 캐릭터: 비공개 캐릭터')).toBeTruthy()
    expect(JSON.parse(window.sessionStorage.getItem('v-mate:combination-selection:v1') || '{}').privateOwnerUserId).toBe('user-1')
  })

  it('keeps an anonymous public selection available without initializing auth', async () => {
    window.sessionStorage.setItem('v-mate:combination-selection:v1', JSON.stringify({
      character: { id: 'public-character', entityType: 'character', slug: 'public-character', name: '공개 캐릭터', visibility: 'public' },
      world: null,
      userId: null,
      privateOwnerUserId: null,
    }))

    render(<App />)

    expect(await screen.findByText('선택 캐릭터: 공개 캐릭터')).toBeTruthy()
    expect(auth.getSession).not.toHaveBeenCalled()
  })

  it('submits global search from another page to visible home results and preserves the query', async () => {
    window.history.replaceState({}, '', '/privacy')
    const user = userEvent.setup()
    render(<App />)

    const search = await screen.findByRole('searchbox', { name: '캐릭터와 월드 검색' })
    await user.type(search, '별빛{Enter}')

    expect(await screen.findByText('검색어: 별빛')).toBeTruthy()
    expect(window.location.pathname).toBe('/')
    expect(new URLSearchParams(window.location.search).get('search')).toBe('별빛')

    await user.click(screen.getByRole('button', { name: '홈으로 이동' }))

    expect(await screen.findByText('검색어:')).toBeTruthy()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('')
  })

  it('remounts the editor when its slug changes so stale asynchronous state cannot cross targets', async () => {
    window.history.replaceState({}, '', '/edit/character/character-a')
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('편집 대상: character-a')).toBeTruthy()
    await user.type(screen.getByLabelText('로컬 편집값'), 'A의 처리 중 상태')
    await user.click(screen.getByRole('button', { name: '다른 캐릭터 편집' }))

    expect(await screen.findByText('편집 대상: character-b')).toBeTruthy()
    expect((screen.getByLabelText('로컬 편집값') as HTMLInputElement).value).toBe('')
  })

  it('keeps the current editor and URL when a dirty browser-back navigation is cancelled', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '캐릭터 편집기 열기' }))
    expect(await screen.findByText('가짜 캐릭터 편집기')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '편집 내용 변경' }))

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })))
    expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경사항이 있습니다' })).toBeNull()

    act(() => window.history.back())

    expect(await screen.findByRole('dialog', { name: '저장하지 않은 변경사항이 있습니다' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/create/character'))
    await user.click(screen.getByRole('button', { name: '계속 편집' }))

    expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경사항이 있습니다' })).toBeNull()
    expect(screen.getByText('가짜 캐릭터 편집기')).toBeTruthy()
  })

  it('moves to an approved browser-back target exactly once despite duplicate confirmation clicks', async () => {
    const user = userEvent.setup()
    const historyGo = vi.spyOn(window.history, 'go')
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '캐릭터 편집기 열기' }))
    await user.click(await screen.findByRole('button', { name: '편집 내용 변경' }))
    act(() => window.history.back())

    const leaveButton = await screen.findByRole('button', { name: '저장하지 않고 이동' })
    await waitFor(() => expect((leaveButton as HTMLButtonElement).disabled).toBe(false))
    act(() => window.history.back())
    await waitFor(() => expect((leaveButton as HTMLButtonElement).disabled).toBe(true))
    await waitFor(() => expect(window.location.pathname).toBe('/create/character'))
    await waitFor(() => expect((leaveButton as HTMLButtonElement).disabled).toBe(false))
    act(() => {
      fireEvent.click(leaveButton)
      fireEvent.click(leaveButton)
    })

    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByText('인증 상태: anonymous')).toBeTruthy()
    expect(historyGo).toHaveBeenCalledTimes(3)
  })

  it('restores and then follows an approved dirty browser-forward target', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '캐릭터 편집기 열기' }))
    await user.click(await screen.findByRole('button', { name: '개인정보로 이동' }))
    await waitFor(() => expect(window.location.pathname).toBe('/privacy'))
    await waitFor(() => expect(screen.queryByText('가짜 캐릭터 편집기')).toBeNull())

    act(() => window.history.back())
    expect(await screen.findByText('가짜 캐릭터 편집기')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '편집 내용 변경' }))
    act(() => window.history.forward())

    const leaveButton = await screen.findByRole('button', { name: '저장하지 않고 이동' })
    await waitFor(() => expect((leaveButton as HTMLButtonElement).disabled).toBe(false))
    await user.click(leaveButton)

    await waitFor(() => expect(window.location.pathname).toBe('/privacy'))
    await waitFor(() => expect(screen.queryByText('가짜 캐릭터 편집기')).toBeNull())
  })
})
