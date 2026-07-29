import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CharacterDetailPage, LibraryPage, OpsPage, RecentRoomsPage, WorldDetailPage } from '@/components/platform/Pages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'
import type { CharacterDetail, WorldDetail } from '@/lib/platform/types'

const api = vi.hoisted(() => ({
  fetchCharacter: vi.fn(),
  fetchWorld: vi.fn(),
  fetchCharacters: vi.fn(),
  fetchWorlds: vi.fn(),
  fetchLibrary: vi.fn(),
  fetchRecentRooms: vi.fn(),
  fetchOpsDashboard: vi.fn(),
  fetchReports: vi.fn(),
  addRecentView: vi.fn(),
  toggleBookmark: vi.fn(),
  createRoom: vi.fn(),
  createReport: vi.fn(),
}))

vi.mock('@/lib/platform/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform/apiClient')>()),
  platformApi: api,
}))

const baseEntity = {
  headline: '한 줄 소개',
  summary: '상세 소개',
  coverImageUrl: '/cover.webp',
  tags: ['테스트'],
  creator: { id: 'creator-1', slug: 'creator-1', name: '제작자' },
  visibility: 'public' as const,
  displayStatus: 'visible' as const,
  sourceType: 'original',
  favoriteCount: 1,
  chatStartCount: 2,
  updatedAt: '2026-07-29T00:00:00.000Z',
}

const character: CharacterDetail = {
  ...baseEntity,
  id: 'character-1',
  entityType: 'character',
  slug: 'character-1',
  name: '상세 캐릭터',
  avatarImageUrl: '/avatar.webp',
  profileSections: [],
  gallery: [],
  imageSlots: [],
}

const world: WorldDetail = {
  ...baseEntity,
  id: 'world-1',
  entityType: 'world',
  slug: 'world-1',
  name: '상세 월드',
  worldSections: [],
  gallery: [],
  characters: [],
}

const chrome: PlatformPageChromeProps = {
  user: { id: 'user-1', email: 'user@example.com', user_metadata: { name: '사용자' } } as unknown as PlatformPageChromeProps['user'],
  authStatus: 'authenticated',
  userAvatarInitial: '사',
  searchQuery: '',
  onSearchChange: vi.fn(),
  onSearchSubmit: vi.fn(),
  onNavigate: vi.fn(),
  onAuthRequest: vi.fn(),
  onSignOut: vi.fn(),
  onDeleteAccount: vi.fn(async () => undefined),
  selectedCharacter: null,
  selectedWorld: null,
  isStartingCombination: false,
  onSelectEntity: vi.fn(),
  onClearSelectedEntity: vi.fn(),
  onStartCombination: vi.fn(async () => undefined),
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchCharacters.mockResolvedValue({ items: [] })
  api.fetchWorlds.mockResolvedValue({ items: [] })
  api.fetchRecentRooms.mockResolvedValue({ items: [] })
  api.fetchLibrary.mockResolvedValue({ bookmarks: [], recentViews: [], recentRooms: [], owned: { characters: [], worlds: [] } })
  api.fetchOpsDashboard.mockResolvedValue({ items: { visibleCharacters: [], hiddenCharacters: [], visibleWorlds: [], hiddenWorlds: [] }, home: { heroMode: 'auto', heroTargetPath: '' } })
  api.fetchReports.mockResolvedValue({ reports: [] })
  api.addRecentView.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('summary-oriented platform page requests', () => {
  it('uses the character detail viewer bookmark state without loading the library', async () => {
    api.fetchCharacter.mockResolvedValueOnce({ item: character, viewer: { bookmarked: true } })
    render(<CharacterDetailPage chrome={chrome} slug="character-1" />)

    expect(await screen.findByRole('button', { name: '즐겨찾기 해제' })).toBeTruthy()
    await waitFor(() => expect(api.addRecentView).toHaveBeenCalledWith('character', 'character-1'))
    expect(api.fetchLibrary).not.toHaveBeenCalled()
  })

  it('uses the world detail viewer bookmark state without loading the library', async () => {
    api.fetchWorld.mockResolvedValueOnce({ item: world, viewer: { bookmarked: true } })
    render(<WorldDetailPage chrome={chrome} slug="world-1" />)

    expect(await screen.findByRole('button', { name: '즐겨찾기 해제' })).toBeTruthy()
    await waitFor(() => expect(api.addRecentView).toHaveBeenCalledWith('world', 'world-1'))
    expect(api.fetchLibrary).not.toHaveBeenCalled()
  })

  it('keeps a partially deployed detail visible and defaults a missing viewer bookmark to false', async () => {
    api.fetchCharacter.mockResolvedValueOnce({ item: character })
    render(<CharacterDetailPage chrome={chrome} slug="character-1" />)

    expect(await screen.findByRole('heading', { name: '상세 캐릭터' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '즐겨찾기 저장' })).toBeTruthy()
    expect(screen.queryByText('캐릭터를 불러오지 못했습니다')).toBeNull()
  })

  it('retries an unavailable bookmark read without issuing an ambiguous toggle', async () => {
    api.fetchCharacter.mockResolvedValue({ item: character, viewer: { bookmarked: null } })
    render(<CharacterDetailPage chrome={chrome} slug="character-1" />)

    const retry = await screen.findByRole('button', { name: '즐겨찾기 다시 확인' })
    fireEvent.click(retry)

    await waitFor(() => expect(api.fetchCharacter).toHaveBeenCalledTimes(2))
    expect(api.toggleBookmark).not.toHaveBeenCalled()
  })

  it('loads the recent page as a 20-room summary list', async () => {
    render(<RecentRoomsPage chrome={chrome} />)

    await waitFor(() => expect(api.fetchRecentRooms).toHaveBeenCalledWith({ limit: 20, includeMessages: false }))
  })

  it('loads the library without duplicate recent-room payloads', async () => {
    render(<LibraryPage chrome={chrome} />)

    await waitFor(() => expect(api.fetchLibrary).toHaveBeenCalledWith({ includeRecentRooms: false }))
  })

  it('shows a retry state instead of loading forever when an old Worker returns a null operations dashboard', async () => {
    api.fetchOpsDashboard.mockResolvedValueOnce(null)
    render(<OpsPage chrome={chrome} />)

    expect(await screen.findByText('현재 운영 상태를 확인하지 못했습니다. 다시 불러와 주세요.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeTruthy()
    expect(screen.queryByText('운영 데이터 불러오는 중…')).toBeNull()
  })
})
