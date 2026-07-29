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
