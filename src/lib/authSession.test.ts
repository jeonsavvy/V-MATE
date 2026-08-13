import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  resolveSupabaseClient: async () => ({ auth }),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('shared auth session resource', () => {
  it('returns a settled snapshot without republishing checking', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'stable-token', user: { id: 'user-1' } } },
      error: null,
    })
    const session = await import('@/lib/authSession')

    const first = await session.loadAuthSession()
    const second = await session.loadAuthSession()

    expect(first.status).toBe('authenticated')
    expect(second).toBe(first)
    expect(auth.getSession).toHaveBeenCalledTimes(1)
    expect(session.readAuthSessionSnapshot().status).toBe('authenticated')
  })

  it('shares an in-flight refresh even when a second caller also forces refresh', async () => {
    let resolveSession!: (value: unknown) => void
    auth.getSession.mockImplementation(() => new Promise((resolve) => { resolveSession = resolve }))
    const session = await import('@/lib/authSession')

    const first = session.loadAuthSession({ force: true })
    const second = session.loadAuthSession({ force: true })
    await vi.waitFor(() => expect(auth.getSession).toHaveBeenCalledTimes(1))
    resolveSession({ data: { session: null }, error: null })

    await expect(first).resolves.toMatchObject({ status: 'anonymous' })
    await expect(second).resolves.toMatchObject({ status: 'anonymous' })
    expect(auth.getSession).toHaveBeenCalledTimes(1)
  })
})
