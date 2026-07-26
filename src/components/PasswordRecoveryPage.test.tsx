import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PasswordRecoveryPage } from '@/components/PasswordRecoveryPage'

const auth = vi.hoisted(() => ({
  configured: true,
  getSession: vi.fn(),
  updateUser: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => auth.configured,
  resolveSupabaseClient: async () => ({
    auth: {
      getSession: auth.getSession,
      updateUser: auth.updateUser,
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: auth.unsubscribe } } })),
    },
  }),
}))

beforeEach(() => {
  auth.configured = true
  auth.getSession.mockResolvedValue({ data: { session: null } })
  auth.updateUser.mockResolvedValue({ error: null })
  window.history.replaceState({}, '', '/auth/recovery')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PasswordRecoveryPage', () => {
  it('shows checking, rejects an expired link, and offers a new reset request', async () => {
    const onOpenAuth = vi.fn()
    const user = userEvent.setup()
    render(<PasswordRecoveryPage onComplete={vi.fn()} onOpenAuth={onOpenAuth} />)

    expect(screen.getByRole('status').textContent).toContain('재설정 링크 확인 중')
    expect((await screen.findByRole('alert')).textContent).toContain('재설정 링크를 확인하지 못했습니다')
    await user.click(screen.getByRole('button', { name: '로그인에서 재설정 요청' }))
    expect(onOpenAuth).toHaveBeenCalledTimes(1)
  })

  it('clears callback credentials only after session exchange and updates the password', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    window.history.replaceState({}, '', '/auth/recovery?code=private-code#access_token=private-token')
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<PasswordRecoveryPage onComplete={onComplete} onOpenAuth={vi.fn()} />)

    const password = await screen.findByLabelText('새 비밀번호')
    expect(window.location.pathname).toBe('/auth/recovery')
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('')
    await user.type(password, 'new-pass')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'new-pass')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    expect(await screen.findByText('비밀번호를 변경했습니다. 이제 로그인할 수 있습니다.')).toBeTruthy()
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass' })
    await user.click(screen.getByRole('button', { name: '홈으로 이동' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('preserves callback credentials across a temporary session-check failure', async () => {
    auth.getSession.mockRejectedValue(new Error('temporary network failure'))
    window.history.replaceState({}, '', '/auth/recovery?code=one-time-code#access_token=one-time-token')
    const user = userEvent.setup()
    render(<PasswordRecoveryPage onComplete={vi.fn()} onOpenAuth={vi.fn()} />)

    expect((await screen.findByRole('alert')).textContent).toContain('링크 정보는 유지되었습니다')
    expect(window.location.search).toBe('?code=one-time-code')
    expect(window.location.hash).toBe('#access_token=one-time-token')
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await user.click(screen.getByRole('button', { name: '다시 확인' }))
    expect((await screen.findByRole('alert')).textContent).toContain('새 링크를 요청해 주세요')
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('')
  })

  it('keeps both inputs when confirmation does not match', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    const user = userEvent.setup()
    render(<PasswordRecoveryPage onComplete={vi.fn()} onOpenAuth={vi.fn()} />)

    const password = await screen.findByLabelText('새 비밀번호') as HTMLInputElement
    const confirmation = screen.getByLabelText('새 비밀번호 확인') as HTMLInputElement
    await user.type(password, 'new-pass')
    await user.type(confirmation, 'different')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    expect(screen.getByRole('alert').textContent).toContain('비밀번호가 일치하지 않습니다')
    expect(password.value).toBe('new-pass')
    expect(confirmation.value).toBe('different')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('does not render provider errors when the update fails', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    auth.updateUser.mockResolvedValue({ error: new Error('SUPABASE_SERVICE_ROLE_KEY stack trace') })
    const user = userEvent.setup()
    render(<PasswordRecoveryPage onComplete={vi.fn()} onOpenAuth={vi.fn()} />)

    await user.type(await screen.findByLabelText('새 비밀번호'), 'new-pass')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'new-pass')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('비밀번호를 변경하지 못했습니다'))
    expect(screen.getByRole('alert').textContent).not.toMatch(/SUPABASE|stack/i)
    expect((screen.getByLabelText('새 비밀번호') as HTMLInputElement).value).toBe('new-pass')
  })
})
