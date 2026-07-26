import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = globalThis as typeof globalThis & {
  __V_MATE_RUNTIME_ENV__?: {
    supabaseUrl?: string
    supabasePublicKey?: string
    chatApiBaseUrl?: string
  }
}

afterEach(() => {
  delete runtime.__V_MATE_RUNTIME_ENV__
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('public runtime configuration', () => {
  it('uses stable public fields for Supabase initialization', async () => {
    runtime.__V_MATE_RUNTIME_ENV__ = {
      supabaseUrl: 'https://runtime.supabase.co',
      supabasePublicKey: 'sb_publishable_runtime',
    }
    vi.resetModules()

    const { isSupabaseConfigured } = await import('@/lib/supabase')

    expect(isSupabaseConfigured()).toBe(true)
  })

  it('uses the stable runtime chat API field', async () => {
    runtime.__V_MATE_RUNTIME_ENV__ = { chatApiBaseUrl: '/runtime-gateway' }
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()

    const { platformApi } = await import('@/lib/platform/apiClient')
    await platformApi.fetchHome()

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/runtime-gateway/api/home?tab=characters&search=&filter=')
  })
})
