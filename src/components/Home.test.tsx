import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Home } from '@/components/Home'
import type { CharacterSummary, HomeFeedPayload, WorldSummary } from '@/lib/platform/types'

const api = vi.hoisted(() => ({
  fetchHome: vi.fn(),
  fetchCharacters: vi.fn(),
  fetchWorlds: vi.fn(),
  fetchRecentRooms: vi.fn(),
}))

vi.mock('@/lib/platform/apiClient', () => ({ platformApi: api }))

const baseEntity = {
  headline: '한 줄 소개',
  summary: '소개',
  coverImageUrl: '/starter/character-a.webp',
  tags: ['오리지널'],
  creator: { id: 'creator-1', slug: 'creator', name: 'V-MATE' },
  visibility: 'public' as const,
  displayStatus: 'visible' as const,
  sourceType: 'original',
  favoriteCount: 0,
  chatStartCount: 0,
  updatedAt: '2026-07-18T00:00:00.000Z',
}

const character = (index: number): CharacterSummary => ({
  ...baseEntity,
  id: `character-${index}`,
  entityType: 'character',
  slug: `character-${index}`,
  name: index === 1 ? '캐릭터A' : index === 2 ? '캐릭터B' : `캐릭터${index}`,
  headline: '테스트 캐릭터',
  avatarImageUrl: index === 1 ? '/starter/character-a.webp' : '/starter/character-b.webp',
})

const world = (index: number): WorldSummary => ({
  ...baseEntity,
  id: `world-${index}`,
  entityType: 'world',
  slug: `world-${index}`,
  name: index === 1 ? '월드A' : '월드B',
  headline: index === 1 ? '현대 도시 월드' : '판타지 하늘섬 월드',
  coverImageUrl: index === 1 ? '/starter/world-a.webp' : '/starter/world-b.webp',
})

const homePayload: HomeFeedPayload = {
  home: {
    defaultTab: 'characters',
    filterChips: ['신작', '인기'],
    hero: null,
    characterFeed: { items: [] },
    worldFeed: { items: [] },
  },
}

const props = {
  user: null,
  userAvatarInitial: 'V',
  searchQuery: '',
  onSearchChange: vi.fn(),
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

afterEach(cleanup)

beforeEach(() => {
  api.fetchHome.mockResolvedValue(homePayload)
  api.fetchRecentRooms.mockResolvedValue({ items: [] })
})

describe('Home catalog states', () => {
  it.each([
    { label: 'zero', characters: [], worlds: [], count: 0 },
    { label: 'one', characters: [character(1)], worlds: [], count: 1 },
    { label: 'many', characters: [character(1), character(2), character(3)], worlds: [world(1), world(2)], count: 5 },
  ])('renders the $label catalog without fake filler cards', async ({ characters, worlds, count }) => {
    api.fetchCharacters.mockResolvedValue({ items: characters })
    api.fetchWorlds.mockResolvedValue({ items: worlds })
    const { container } = render(<Home {...props} />)
    await waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(count))
    if (count === 0) expect(screen.getByText('공개된 캐릭터가 없습니다')).toBeTruthy()
  })

  it('places the two starter characters and two starter worlds in two-column grids', async () => {
    api.fetchCharacters.mockResolvedValue({ items: [character(1), character(2)] })
    api.fetchWorlds.mockResolvedValue({ items: [world(1), world(2)] })
    const { container } = render(<Home {...props} />)

    await waitFor(() => expect(container.querySelectorAll('article')).toHaveLength(4))
    const characterGrid = container.querySelector('[data-catalog-grid="characters"]')
    const worldGrid = container.querySelector('[data-catalog-grid="worlds"]')
    expect(characterGrid?.className).toContain('grid-cols-2')
    expect(worldGrid?.className).toContain('grid-cols-2')
    expect(characterGrid?.children).toHaveLength(2)
    expect(worldGrid?.children).toHaveLength(2)
    expect(within(characterGrid as HTMLElement).getAllByText('캐릭터')).toHaveLength(2)
    expect(within(worldGrid as HTMLElement).getAllByText('월드')).toHaveLength(2)
    expect(screen.getAllByText('테스트 캐릭터')).toHaveLength(2)
    expect(screen.getByText('현대 도시 월드')).toBeTruthy()
    expect(screen.getByText('판타지 하늘섬 월드')).toBeTruthy()
  })
})
