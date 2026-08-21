import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthDialog } from '@/components/AuthDialog'

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  resolveSupabaseClient: async () => ({ auth }),
}))

vi.mock('@/lib/logger', () => ({ devError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

beforeEach(() => {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null })
  auth.signUp.mockResolvedValue({
    data: { user: { id: 'fixture-user' }, session: { access_token: 'fixture-token' } },
    error: null,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AuthDialog password reset', () => {
  it('submits reset email through an independent form instead of the sign-in form', async () => {
    render(<AuthDialog open onOpenChange={vi.fn()} initialMode="reset" />)

    const resetForm = await screen.findByRole('form', { name: '비밀번호 재설정' })
    const resetEmail = screen.getByLabelText('이메일', { selector: '#reset-email' })
    fireEvent.change(resetEmail, { target: { value: 'reset@example.com' } })
    fireEvent.submit(resetForm)

    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1))
    expect(auth.resetPasswordForEmail.mock.calls[0][0]).toBe('reset@example.com')
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '로그인' }).closest('form')).not.toBe(resetForm)
  })
})

describe('AuthDialog signup', () => {
  const openSignup = async () => {
    const signInTab = screen.getByRole('tab', { name: '로그인' })
    const signUpTab = screen.getByRole('tab', { name: '회원가입' })
    await waitFor(() => expect(signInTab.getAttribute('aria-selected')).toBe('true'))
    fireEvent.mouseDown(signUpTab, { button: 0, ctrlKey: false })
    await waitFor(() => expect(signUpTab.getAttribute('aria-selected')).toBe('true'))
  }

  const submitSignup = async () => {
    const signUpTab = screen.getByRole('tab', { name: '회원가입' })
    if (signUpTab.getAttribute('aria-selected') !== 'true') await openSignup()
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '테스터' } })
    fireEvent.change(screen.getByLabelText('이메일', { selector: '#signup-email' }), {
      target: { value: 'new@example.com' },
    })
    fireEvent.change(screen.getByLabelText('비밀번호', { selector: '#signup-password' }), {
      target: { value: 'secret123' },
    })
    fireEvent.change(screen.getByLabelText('비밀번호 확인'), {
      target: { value: 'secret123' },
    })
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }))
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1))
  }

  it('starts an active session immediately without an email-confirmation step', async () => {
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()
    render(<AuthDialog open onOpenChange={onOpenChange} onSuccess={onSuccess} />)

    await openSignup()
    expect(screen.getByRole('heading', { name: '계정 만들기' })).toBeTruthy()
    expect(screen.getByText('가입하면 바로 로그인됩니다.')).toBeTruthy()
    await submitSignup()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByText(/확인 메일/)).toBeNull()
  })

  it('does not claim success when signup returns no active session', async () => {
    auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'fixture-user' }, session: null },
      error: null,
    })
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()
    render(<AuthDialog open onOpenChange={onOpenChange} onSuccess={onSuccess} />)

    await submitSignup()

    expect((await screen.findByRole('alert')).textContent).toContain(
      '가입을 완료하지 못했습니다. 이미 가입했다면 로그인해 주세요.',
    )
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.queryByText(/확인 메일/)).toBeNull()
  })
})
