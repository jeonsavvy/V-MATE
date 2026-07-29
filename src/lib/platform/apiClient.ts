import type {
  CatalogFilter,
  CharacterDetailPayload,
  CharacterSummary,
  ChatQuota,
  ContentReport,
  EntityType,
  HomeFeedPayload,
  LibraryPayload,
  OwnerOpsDashboard,
  RoomChatResponse,
  RoomSummary,
  Visibility,
  WorldDetailPayload,
  WorldSummary,
} from '@/lib/platform/types'
import { getBrowserOrigin } from '@/lib/browserRuntime'

/** Public API failures never expose upstream/provider messages to the UI. */
export class PlatformApiError extends Error {
  code: string
  status: number
  retryable: boolean
  traceId?: string
  details?: { targetType?: 'character' | 'world'; quota?: ChatQuota }

  constructor(options: { code?: string; status: number; details?: { targetType?: 'character' | 'world'; quota?: ChatQuota }; traceId?: string }) {
    super('요청을 처리하지 못했습니다.')
    this.name = 'PlatformApiError'
    this.code = options.code || 'REQUEST_FAILED'
    this.status = options.status
    this.retryable = options.status === 0 || options.status === 408 || options.status === 429 || options.status >= 500
    this.details = options.details
    this.traceId = options.traceId
  }
}

export interface UserFacingError {
  title: string
  message: string
  recovery: 'retry' | 'login' | 'home' | 'library' | 'new-reset-link' | 'none'
}

export interface RecentRoomsOptions {
  limit?: number
  includeMessages?: boolean
}

export interface LibraryOptions {
  includeRecentRooms?: boolean
}

export const toUserFacingError = (error: unknown, fallback = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'): UserFacingError => {
  const typed = error instanceof PlatformApiError ? error : null
  if (typed?.code.endsWith('_NOT_FOUND')) return { title: '콘텐츠를 찾을 수 없습니다', message: '삭제되었거나 접근할 수 없는 콘텐츠입니다.', recovery: 'home' }
  switch (typed?.code) {
    case 'UNAUTHORIZED': case 'AUTH_UNAUTHORIZED': case 'AUTH_REQUIRED': return { title: '로그인이 필요합니다', message: '이 작업을 계속하려면 다시 로그인해 주세요.', recovery: 'login' }
    case 'CHAT_DAILY_LIMIT_EXCEEDED': return { title: '오늘의 대화 한도에 도달했습니다', message: '한도가 초기화된 뒤 다시 대화를 시작할 수 있습니다.', recovery: 'none' }
    case 'CHAT_REQUEST_IN_PROGRESS': return { title: '메시지를 처리 중입니다', message: '현재 메시지의 응답을 기다린 뒤 다시 시도해 주세요.', recovery: 'retry' }
    case 'CLIENT_REQUEST_ID_CONFLICT': return { title: '메시지를 다시 확인해 주세요', message: '새로고침 후 다시 전송해 주세요.', recovery: 'retry' }
    case 'NOT_FOUND': case 'ROOM_TARGET_NOT_FOUND': case 'ROOM_TARGET_UNAVAILABLE': return { title: '콘텐츠를 찾을 수 없습니다', message: '삭제되었거나 현재 대화를 시작할 수 없는 콘텐츠입니다.', recovery: 'home' }
    case 'FEATURE_TEMPORARILY_UNAVAILABLE': return { title: '지금은 사용할 수 없습니다', message: '잠시 후 다시 시도해 주세요.', recovery: 'retry' }
    case 'INVALID_ASSET_REFERENCE': return { title: '이미지를 확인해 주세요', message: '선택한 이미지 참조가 유효하지 않습니다. 이미지를 다시 선택해 주세요.', recovery: 'retry' }
    case 'CONTENT_DELETE_STATE_UNKNOWN': return { title: '삭제 결과를 확인해 주세요', message: '삭제 결과를 확인하지 못했습니다. 보관함이나 목록을 다시 불러와 현재 상태를 확인해 주세요.', recovery: 'library' }
    case 'ACCOUNT_DELETE_STORAGE_STATE_UNKNOWN': return { title: '계정 탈퇴를 완료하지 못했습니다', message: '계정은 유지되지만 업로드 이미지 일부의 정리 상태를 확인하지 못했습니다. 현재 화면에서 다시 시도해 주세요.', recovery: 'retry' }
    case 'ACCOUNT_DELETE_PARTIAL_STORAGE_REMOVED': return { title: '계정 탈퇴를 완료하지 못했습니다', message: '계정은 유지되지만 업로드 이미지는 정리되었습니다. 계정 탈퇴를 다시 시도해 주세요.', recovery: 'retry' }
    case 'ACCOUNT_DELETE_STATE_UNKNOWN': return { title: '계정 상태를 확인해 주세요', message: '계정 탈퇴 결과를 확인하지 못했습니다. 다시 로그인해 계정 상태를 확인해 주세요.', recovery: 'login' }
    case 'NETWORK_ERROR': return { title: '연결을 확인해 주세요', message: fallback, recovery: 'retry' }
    default: return { title: '요청을 완료하지 못했습니다', message: fallback, recovery: 'retry' }
  }
}

// 브라우저에서는 same-origin /api를 우선 사용하고, 교차 출처 설정은 명시적으로만 허용한다.
type ClientRuntimeEnv = {
  chatApiBaseUrl?: string
}

const resolveRuntimeEnv = () =>
  ((globalThis as { __V_MATE_RUNTIME_ENV__?: ClientRuntimeEnv }).__V_MATE_RUNTIME_ENV__ ?? {})

const resolveApiBaseUrl = () => {
  const runtimeEnv = resolveRuntimeEnv()
  const configured = String(runtimeEnv.chatApiBaseUrl || import.meta.env.VITE_CHAT_API_BASE_URL || '')
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

// 인증이 필요한 요청만 지연 토큰 조회를 수행해 비로그인 탐색 흐름을 가볍게 유지한다.
const resolveAccessToken = async () => {
  const supabaseModule = await import('@/lib/supabase')
  if (!supabaseModule.isSupabaseConfigured()) {
    return null
  }

  const supabase = await supabaseModule.resolveSupabaseClient()
  if (!supabase) {
    throw new PlatformApiError({ status: 503, code: 'FEATURE_TEMPORARILY_UNAVAILABLE' })
  }

  let sessionResult
  try {
    sessionResult = await supabase.auth.getSession()
  } catch {
    throw new PlatformApiError({ status: 503, code: 'FEATURE_TEMPORARILY_UNAVAILABLE' })
  }
  const { data, error } = sessionResult
  if (error) throw new PlatformApiError({ status: 503, code: 'FEATURE_TEMPORARILY_UNAVAILABLE' })
  if (!data?.session?.access_token) return null

  return data.session.access_token
}

const request = async <T>(path: string, init?: RequestInit & { auth?: boolean; optionalAuth?: boolean }): Promise<T> => {
  const headers = new Headers(init?.headers || {})
  headers.set('Content-Type', 'application/json')

  if (init?.auth || init?.optionalAuth) {
    const token = await resolveAccessToken()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    } else if (init?.auth) {
      throw new PlatformApiError({ status: 401, code: 'AUTH_REQUIRED' })
    }
  }

  let response: Response
  try {
    response = await fetch(`${resolveApiBaseUrl()}${path}`, { ...init, headers })
  } catch {
    throw new PlatformApiError({ status: 0, code: 'NETWORK_ERROR' })
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    throw new PlatformApiError({ status: response.ok ? 502 : response.status, code: 'INVALID_API_RESPONSE' })
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const rawDetails = typeof data.details === 'object' && data.details !== null ? data.details as Record<string, unknown> : {}
    const rawQuota = typeof rawDetails.quota === 'object' && rawDetails.quota !== null ? rawDetails.quota as Record<string, unknown> : null
    const quota = rawQuota
      && Number.isFinite(rawQuota.limit)
      && Number.isFinite(rawQuota.remaining)
      && typeof rawQuota.resetAt === 'string'
      ? { limit: Number(rawQuota.limit), remaining: Number(rawQuota.remaining), resetAt: rawQuota.resetAt }
      : undefined
    const targetType: 'character' | 'world' | undefined = rawDetails.targetType === 'character' || rawDetails.targetType === 'world' ? rawDetails.targetType : undefined
    const details: { targetType?: 'character' | 'world'; quota?: ChatQuota } | undefined = targetType || quota ? { targetType, quota } : undefined
    throw new PlatformApiError({
      status: response.status,
      code: typeof data.error_code === 'string' ? data.error_code : typeof data.errorCode === 'string' ? data.errorCode : undefined,
      details,
      traceId: typeof data.trace_id === 'string' && data.trace_id.length <= 128 ? data.trace_id : undefined,
    })
  }
  return data as T
}

export const platformApi = {
  fetchHome: (
    tab: 'characters' | 'worlds' = 'characters',
    search = '',
    characterFilter: CatalogFilter = '',
    worldFilter: CatalogFilter = characterFilter,
  ) => request<HomeFeedPayload>(`/home?tab=${tab}&search=${encodeURIComponent(search)}&characterFilter=${encodeURIComponent(characterFilter)}&worldFilter=${encodeURIComponent(worldFilter)}`),
  fetchCharacters: (search = '', filter: 'new' | 'popular' | '' = '') => request<{ items: CharacterSummary[] }>(`/characters?search=${encodeURIComponent(search)}&filter=${encodeURIComponent(filter)}`),
  fetchWorlds: (search = '', filter: 'new' | 'popular' | '' = '') => request<{ items: WorldSummary[] }>(`/worlds?search=${encodeURIComponent(search)}&filter=${encodeURIComponent(filter)}`),
  fetchCharacter: (slug: string) => request<CharacterDetailPayload>(`/characters/${slug}`, { optionalAuth: true }),
  fetchWorld: (slug: string) => request<WorldDetailPayload>(`/worlds/${slug}`, { optionalAuth: true }),
  fetchRecentRooms: ({ limit = 20, includeMessages = true }: RecentRoomsOptions = {}) => request<{ items: RoomSummary[] }>(`/recent-rooms?limit=${limit}&includeMessages=${includeMessages}`, { auth: true }),
  fetchLibrary: ({ includeRecentRooms = true }: LibraryOptions = {}) => request<LibraryPayload>(`/library?includeRecentRooms=${includeRecentRooms}`, { auth: true }),
  fetchOpsDashboard: () => request<OwnerOpsDashboard>('/ops/dashboard', { auth: true }),
  prepareUploads: (payload: { entityType: EntityType; variants: Array<{ kind: string; width: number; height: number }> }) =>
    request<{ bucket: string; expiresAt: string; uploads: Array<{ kind: string; width: number; height: number; path: string; token: string; signedUrl: string; publicUrl: string; bucket: string; expiresAt?: string }> }>('/uploads/prepare', {
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
    sourceUrl?: string
    rightsConfirmed?: boolean
    creatorName?: string
    coverImageUrl?: string
    avatarImageUrl?: string
    profileJson?: Record<string, unknown>
    speechStyleJson?: Record<string, unknown>
    promptProfileJson?: Record<string, unknown>
    assets?: Array<{ kind: string; url: string; width: number; height: number }>
  }) => request<{ item: CharacterSummary }>('/characters', { method: 'POST', auth: true, body: JSON.stringify(payload) }),
  updateCharacter: (slug: string, payload: {
    name: string
    headline: string
    summary: string
    tags: string[]
    visibility: Visibility
    sourceType: string
    sourceUrl?: string
    rightsConfirmed?: boolean
    creatorName?: string
    coverImageUrl?: string
    avatarImageUrl?: string
    profileJson?: Record<string, unknown>
    speechStyleJson?: Record<string, unknown>
    promptProfileJson?: Record<string, unknown>
    assets?: Array<{ kind: string; url: string; width: number; height: number }>
  }) => request<{ item: CharacterSummary }>(`/characters/${slug}`, { method: 'PATCH', auth: true, body: JSON.stringify(payload) }),
  deleteCharacter: (slug: string) => request<{ ok: boolean }>(`/characters/${slug}`, { method: 'DELETE', auth: true }),
  createWorld: (payload: {
    name: string
    headline: string
    summary: string
    tags: string[]
    visibility: Visibility
    sourceType: string
    sourceUrl?: string
    rightsConfirmed?: boolean
    creatorName?: string
    coverImageUrl?: string
    worldRulesMarkdown?: string
    promptProfileJson?: Record<string, unknown>
    assets?: Array<{ kind: string; url: string; width: number; height: number }>
  }) => request<{ item: WorldSummary }>('/worlds', { method: 'POST', auth: true, body: JSON.stringify(payload) }),
  updateWorld: (slug: string, payload: {
    name: string
    headline: string
    summary: string
    tags: string[]
    visibility: Visibility
    sourceType: string
    sourceUrl?: string
    rightsConfirmed?: boolean
    creatorName?: string
    coverImageUrl?: string
    worldRulesMarkdown?: string
    promptProfileJson?: Record<string, unknown>
    assets?: Array<{ kind: string; url: string; width: number; height: number }>
  }) => request<{ item: WorldSummary }>(`/worlds/${slug}`, { method: 'PATCH', auth: true, body: JSON.stringify(payload) }),
  deleteWorld: (slug: string) => request<{ ok: boolean }>(`/worlds/${slug}`, { method: 'DELETE', auth: true }),
  createRoom: (payload: { characterSlug: string; worldSlug?: string | null; userAlias?: string }) => request<{ room: RoomSummary }>('/rooms', { method: 'POST', auth: true, body: JSON.stringify(payload) }),
  fetchRoom: (roomId: string) => request<{ room: RoomSummary }>(`/rooms/${roomId}`, { auth: true }),
  sendRoomMessage: (roomId: string, userMessage: string, clientRequestId: string) => request<RoomChatResponse>(`/rooms/${roomId}/chat`, { method: 'POST', auth: true, body: JSON.stringify({ userMessage, clientRequestId }) }),
  fetchChatQuota: () => request<{ quota: ChatQuota }>('/me/chat-quota', { auth: true }),
  createReport: (payload: { entityType: EntityType; entityId: string; reason: string; details?: string }) => request<{ report: ContentReport }>('/reports', { method: 'POST', auth: true, body: JSON.stringify(payload) }),
  fetchReports: (status = 'open') => request<{ reports: ContentReport[] }>(`/ops/reports?status=${encodeURIComponent(status)}`, { auth: true }),
  applyReportAction: (reportId: string, action: 'dismiss' | 'restore' | 'quarantine' | 'remove', note = '') => request<{ reportId: string; moderationStatus: string; action: string }>(`/ops/reports/${reportId}`, { method: 'PATCH', auth: true, body: JSON.stringify({ action, note }) }),
  addRecentView: (entityType: EntityType, entityRef: string) => request<{ ok: boolean }>('/recent-views', { method: 'POST', auth: true, body: JSON.stringify({ entityType, entityRef }) }),
  toggleBookmark: (entityType: EntityType, entityRef: string) => request<{ active: boolean; id: string }>('/bookmarks', { method: 'POST', auth: true, body: JSON.stringify({ entityType, entityRef }) }),
  deleteAccount: () => request<{ ok: boolean; deleted: boolean; data?: { deleted?: boolean; deletedCharacters?: number; deletedWorlds?: number; deletedRooms?: number; removedAssets?: number } }>('/account', { method: 'DELETE', auth: true }),
  hideContent: (entityType: EntityType, id: string) => request<{ ok: boolean }>(`/ops/content/${entityType}/${id}/hide`, { method: 'POST', auth: true, body: JSON.stringify({}) }),
  showContent: (entityType: EntityType, id: string) => request<{ ok: boolean }>(`/ops/content/${entityType}/${id}/show`, { method: 'POST', auth: true, body: JSON.stringify({}) }),
  deleteContent: (entityType: EntityType, id: string) => request<{ ok: boolean }>(`/ops/content/${entityType}/${id}`, { method: 'DELETE', auth: true }),
  setBannerMode: (mode: 'auto' | 'manual') => request<{ home: { heroMode: 'auto' | 'manual'; heroTargetPath: string } }>('/ops/home/banner-mode', { method: 'POST', auth: true, body: JSON.stringify({ mode }) }),
  setBannerTarget: (targetPath: string) => request<{ home: { heroMode: 'auto' | 'manual'; heroTargetPath: string } }>('/ops/home/banner-target', { method: 'POST', auth: true, body: JSON.stringify({ targetPath }) }),
}
