import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  configured: true,
  getSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => auth.configured,
  resolveSupabaseClient: async () => ({ auth: { getSession: auth.getSession } }),
}))

beforeEach(() => {
  auth.configured = true
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('optional authenticated detail requests', () => {
  it('uses a public request only for a confirmed anonymous session', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ item: { id: 'public' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Test-Authorization': new Headers(init?.headers).get('Authorization') || '' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { platformApi } = await import('@/lib/platform/apiClient')

    await platformApi.fetchCharacter('public-character')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false)
  })

  it('surfaces session resolution failure instead of falling back to public', async () => {
    auth.getSession.mockRejectedValue(new Error('private provider stack'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { platformApi } = await import('@/lib/platform/apiClient')

    await expect(platformApi.fetchCharacter('owned-private')).rejects.toMatchObject({
      code: 'FEATURE_TEMPORARILY_UNAVAILABLE',
      status: 503,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry an invalid bearer as an anonymous request', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'expired-token' } }, error: null })
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error_code: 'AUTH_UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { platformApi } = await import('@/lib/platform/apiClient')

    await expect(platformApi.fetchCharacter('owned-private')).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED', status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer expired-token')
  })
})
