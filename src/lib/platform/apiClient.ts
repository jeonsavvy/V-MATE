import type {
  CharacterDetail,
  CharacterSummary,
  CharacterWorldLinkSummary,
  EntityType,
  HomeFeedPayload,
  LibraryPayload,
  OwnerOpsDashboard,
  RoomChatResponse,
  RoomSummary,
  Visibility,
  WorldDetail,
  WorldSummary,
} from '@/lib/platform/types'
import { demoPlatform } from '@/lib/platform/demoData'
import { getBrowserOrigin } from '@/lib/browserRuntime'

const resolveRuntimeEnv = () =>
  ((globalThis as { __V_MATE_RUNTIME_ENV__?: Record<string, string | undefined> }).__V_MATE_RUNTIME_ENV__ ?? {})

const resolveApiBaseUrl = () => {
  const runtimeEnv = resolveRuntimeEnv()
  const configured = String(runtimeEnv.VITE_CHAT_API_BASE_URL || import.meta.env.VITE_CHAT_API_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '')

  const normalizeConfigured = (value: string) => {
    if (!value) return '/api'
    if (value.endsWith('/api/chat')) return value.slice(0, -'/api/chat'.length) + '/api'
    if (value.endsWith('/api')) return value
    return `${value}/api`
  }

  if (typeof window !== 'undefined') {
    const currentOrigin = getBrowserOrigin()
    if (!configured) return '/api'
    try {
      const normalized = normalizeConfigured(configured)
      const resolved = new URL(normalized, currentOrigin)
      if (resolved.origin !== currentOrigin) {
        return '/api'
      }
      return resolved.pathname.endsWith('/api') ? resolved.pathname : '/api'
    } catch {
      return '/api'
    }
  }

  return normalizeConfigured(configured)
}

const resolveAccessToken = async () => {
  const supabaseModule = await import('@/lib/supabase')
  if (!supabaseModule.isSupabaseConfigured()) {
    throw new Error('로그인이 필요합니다.')
  }

  const supabase = await supabaseModule.resolveSupabaseClient()
  if (!supabase) {
    throw new Error('인증 클라이언트를 초기화하지 못했습니다.')
  }

  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session?.access_token) {
    throw new Error('로그인이 필요합니다.')
  }

  return data.session.access_token
}

const request = async <T>(path: string, init?: RequestInit & { auth?: boolean; fallback?: () => T }): Promise<T> => {
  const headers = new Headers(init?.headers || {})
  headers.set('Content-Type', 'application/json')

  if (init?.auth) {
    const token = await resolveAccessToken()
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`${resolveApiBaseUrl()}${path}`, { ...init, headers })
  } catch (error) {
    if (init?.fallback) return init.fallback()
    throw error
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html') && init?.fallback) {
    return init.fallback()
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '요청 처리에 실패했습니다.')
  }
  if (init?.fallback && (!data || (typeof data === 'object' && Object.keys(data).length === 0))) {
    return init.fallback()
  }
  return data as T
}

export const platformApi = {
  fetchHome: (tab: 'characters' | 'worlds' = 'characters', search = '', filter: 'new' | 'popular' | '' = '') => request<HomeFeedPayload>(`/home?tab=${tab}&search=${encodeURIComponent(search)}&filter=${encodeURIComponent(filter)}`, { fallback: () => demoPlatform.home(tab, filter) }),
  fetchCharacters: (search = '', filter: 'new' | 'popular' | '' = '') => request<{ items: CharacterSummary[] }>(`/characters?search=${encodeURIComponent(search)}&filter=${encodeURIComponent(filter)}`, { fallback: () => ({ items: demoPlatform.characters(search, filter) }) }),
  fetchWorlds: (search = '', filter: 'new' | 'popular' | '' = '') => request<{ items: WorldSummary[] }>(`/worlds?search=${encodeURIComponent(search)}&filter=${encodeURIComponent(filter)}`, { fallback: () => ({ items: demoPlatform.worlds(search, filter) }) }),
  fetchCharacter: (slug: string) => request<{ item: CharacterDetail }>(`/characters/${slug}`, { fallback: () => ({ item: demoPlatform.character(slug)! }) }),
  fetchWorld: (slug: string) => request<{ item: WorldDetail }>(`/worlds/${slug}`, { fallback: () => ({ item: demoPlatform.world(slug)! }) }),
  fetchCharacterWorldLinks: (slug: string) => request<{ items: CharacterWorldLinkSummary[] }>(`/characters/${slug}/world-links`, { fallback: () => ({ items: demoPlatform.worldLinks(slug) }) }),
  fetchRecentRooms: () => request<{ items: RoomSummary[] }>('/recent-rooms', { auth: true, fallback: () => ({ items: demoPlatform.recentRooms() }) }),
  fetchLibrary: () => request<LibraryPayload>('/library', { auth: true, fallback: () => demoPlatform.library() }),
  fetchOpsDashboard: () => request<OwnerOpsDashboard>('/ops/dashboard', { auth: true, fallback: () => demoPlatform.ops() }),
  prepareUploads: (payload: { entityType: EntityType; variants: Array<{ kind: string; width: number; height: number }> }) =>
    request<{ bucket: string; uploads: Array<{ kind: string; width: number; height: number; path: string; token: string; signedUrl: string; publicUrl: string; bucket: string }> }>('/uploads/prepare', {
      method: 'POST',
      auth: true,
      body: JSON.stringify(payload),
    }),
  createCharacter: (payload: {
    name: string
    headline: string
    summary: string
    tags: string[]
    visibility: Visibility
    sourceType: string
    coverImageUrl?: string
    avatarImageUrl?: string
    profileJson?: Record<string, unknown>
    speechStyleJson?: Record<string, unknown>
    promptProfileJson?: Record<string, unknown>
    assets?: Array<{ kind: string; url: string; width: number; height: number }>
  }) => request<{ item: CharacterSummary }>('/characters', { method: 'POST', auth: true, body: JSON.stringify(payload) }),
  createWorld: (payload: {
    name: string
    headline: string
    summary: string
    tags: string[]
    visibility: Visibility
    sourceType: string
    coverImageUrl?: string
    worldRulesMarkdown?: string
    promptProfileJson?: Record<string, unknown>
    assets?: Array<{ kind: string; url: string; width: number; height: number }>
  }) => request<{ item: WorldSummary }>('/worlds', { method: 'POST', auth: true, body: JSON.stringify(payload) }),
  createCharacterWorldLink: (payload: {
    characterSlug: string
    worldSlug: string
    linkReason: string
    defaultOpeningContext?: string
    defaultRelationshipContext?: string
    isRecommended?: boolean
  }) => request<{ item: CharacterWorldLinkSummary }>('/character-world-links', { method: 'POST', auth: true, body: JSON.stringify(payload) }),
  createRoom: (payload: { characterSlug: string; worldSlug?: string | null; userAlias?: string }) => request<{ room: RoomSummary }>('/rooms', { method: 'POST', auth: true, body: JSON.stringify(payload) }),
  fetchRoom: (roomId: string) => request<{ room: RoomSummary }>(`/rooms/${roomId}`, { auth: true }),
  sendRoomMessage: (roomId: string, userMessage: string) => request<RoomChatResponse>(`/rooms/${roomId}/chat`, { method: 'POST', auth: true, body: JSON.stringify({ userMessage }) }),
  addRecentView: (entityType: EntityType, entityRef: string) => request<{ ok: boolean }>('/recent-views', { method: 'POST', auth: true, body: JSON.stringify({ entityType, entityRef }) }),
  toggleBookmark: (entityType: EntityType, entityRef: string) => request<{ active: boolean; id: string }>('/bookmarks', { method: 'POST', auth: true, body: JSON.stringify({ entityType, entityRef }) }),
  hideContent: (entityType: EntityType, id: string) => request<{ ok: boolean }>(`/ops/content/${entityType}/${id}/hide`, { method: 'POST', auth: true, body: JSON.stringify({}) }),
  showContent: (entityType: EntityType, id: string) => request<{ ok: boolean }>(`/ops/content/${entityType}/${id}/show`, { method: 'POST', auth: true, body: JSON.stringify({}) }),
  deleteContent: (entityType: EntityType, id: string) => request<{ ok: boolean }>(`/ops/content/${entityType}/${id}`, { method: 'DELETE', auth: true }),
  setBannerMode: (mode: 'auto' | 'manual') => request<{ home: { heroMode: 'auto' | 'manual'; heroTargetPath: string } }>('/ops/home/banner-mode', { method: 'POST', auth: true, body: JSON.stringify({ mode }) }),
  setBannerTarget: (targetPath: string) => request<{ home: { heroMode: 'auto' | 'manual'; heroTargetPath: string } }>('/ops/home/banner-target', { method: 'POST', auth: true, body: JSON.stringify({ targetPath }) }),
}
