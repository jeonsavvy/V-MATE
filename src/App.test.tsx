import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { getStoredKeys, removeStoredItem } from '@/lib/browserStorage'

type HomeProps = {
  authStatus: 'checking' | 'authenticated' | 'anonymous' | 'unavailable'
  onAuthRequest: () => void
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
  Home: ({ authStatus, onAuthRequest }: HomeProps) => (
    <main>
      <p>인증 상태: {authStatus}</p>
      <button type="button" onClick={onAuthRequest}>{authStatus === 'unavailable' ? '인증 다시 확인' : '로그인'}</button>
    </main>
  ),
}))

vi.mock('@/components/AuthDialog', () => ({ AuthDialog: () => null }))

beforeEach(() => {
  getStoredKeys().forEach((key) => removeStoredItem(key))
  window.sessionStorage.clear()
  window.history.replaceState({}, '', '/')
  auth.getSession.mockReset()
  auth.unsubscribe.mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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
})
