import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomPage } from '@/components/platform/Pages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'
import type { RoomSummary } from '@/lib/platform/types'

const api = vi.hoisted(() => ({
  fetchRoom: vi.fn(),
  fetchChatQuota: vi.fn(),
  sendRoomMessage: vi.fn(),
}))

vi.mock('@/lib/platform/apiClient', () => ({ platformApi: api }))

const baseEntity = {
  headline: '테스트',
  summary: '테스트 콘텐츠',
  tags: ['테스트'],
  creator: { id: 'creator-1', slug: 'v-mate', name: 'V-MATE' },
  visibility: 'public' as const,
  displayStatus: 'visible' as const,
  sourceType: 'original',
  favoriteCount: 0,
  chatStartCount: 0,
  updatedAt: '2026-07-21T00:00:00.000Z',
}

const room: RoomSummary = {
  id: 'room-1',
  title: '캐릭터A · 월드A',
  userAlias: '나',
  character: {
    ...baseEntity,
    id: 'character-a',
    entityType: 'character',
    slug: 'character-a',
    name: '캐릭터A',
    coverImageUrl: '/starter/character-a.webp',
    avatarImageUrl: '/starter/character-a.webp',
    imageSlots: [],
  },
  world: {
    ...baseEntity,
    id: 'world-a',
    entityType: 'world',
    slug: 'world-a',
    name: '월드A',
    coverImageUrl: '/starter/world-a.webp',
    imageSlots: [],
  },
  bridgeProfile: {
    entryMode: 'in_world',
    characterRoleInWorld: '등장인물',
    userRoleInWorld: '대화 상대',
    meetingTrigger: '첫 만남',
    relationshipDistance: '초면',
    currentGoal: '대화하기',
    startingLocation: '지하철 입구',
    worldTerms: [],
    firstScenePressure: '비가 막 그쳤다',
  },
  state: {
    currentSituation: '비가 막 그친 밤이다.',
    location: '지하철 입구',
    relationshipState: '초면',
    inventory: [],
    appearance: [],
    pose: [],
    futurePromises: [],
    worldNotes: [],
  },
  messages: [{
    id: 'assistant-1',
    role: 'assistant',
    createdAt: '2026-07-21T00:00:00.000Z',
    content: {
      emotion: 'normal',
      inner_heart: '',
      response: '안녕하세요.',
      world_image_slot: 'main',
    },
  }],
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  lastMessageAt: '2026-07-21T00:00:00.000Z',
}

const chrome: PlatformPageChromeProps = {
  user: { id: 'user-1', email: 'user@example.com', user_metadata: { name: '사용자' } } as unknown as PlatformPageChromeProps['user'],
  userAvatarInitial: '사',
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
  vi.clearAllMocks()
  api.fetchRoom.mockResolvedValue({ room })
  api.fetchChatQuota.mockResolvedValue({
    quota: { limit: 30, remaining: 28, resetAt: '2026-07-22T00:00:00+09:00' },
  })
})

describe('RoomPage artwork hierarchy', () => {
  it('keeps the character portrait as the primary desktop artwork when a world is selected', async () => {
    render(<RoomPage chrome={chrome} roomId={room.id} />)

    const conversationInfo = await screen.findByRole('complementary', { name: '대화 정보' })
    const characterArtwork = within(conversationInfo).getByRole('img', { name: '캐릭터A' })
    expect(characterArtwork.getAttribute('src')).toBe('/starter/character-a.webp')
    expect(characterArtwork.parentElement?.className).toContain('aspect-[4/5]')

    const worldArtwork = within(conversationInfo).getByRole('img', { name: '월드A 월드 배경' })
    expect(worldArtwork.getAttribute('src')).toBe('/starter/world-a.webp')
    expect(worldArtwork.parentElement?.className).toContain('aspect-[16/9]')
    expect(characterArtwork.compareDocumentPosition(worldArtwork) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders a character-only room without an empty world artwork section', async () => {
    api.fetchRoom.mockResolvedValueOnce({
      room: { ...room, title: '캐릭터A', world: null },
    })

    render(<RoomPage chrome={chrome} roomId={room.id} />)

    const conversationInfo = await screen.findByRole('complementary', { name: '대화 정보' })
    expect(within(conversationInfo).getByRole('img', { name: '캐릭터A' }).getAttribute('src')).toBe('/starter/character-a.webp')
    expect(within(conversationInfo).queryByText('월드 · 월드A')).toBeNull()
    expect(screen.getByRole('button', { name: '캐릭터 보기' })).toBeTruthy()
  })

  it('switches both artworks from the latest assistant image slots', async () => {
    api.fetchRoom.mockResolvedValueOnce({
      room: {
        ...room,
        character: {
          ...room.character,
          imageSlots: [{
            id: 'character-happy',
            slot: 'happy',
            usage: '밝은 표정',
            trigger: '기쁜 장면',
            priority: 1,
            detailUrl: '/starter/character-a-happy.webp',
          }],
        },
        world: room.world ? {
          ...room.world,
          imageSlots: [{
            id: 'world-night',
            slot: 'night',
            usage: '야경',
            trigger: '밤 장면',
            priority: 1,
            detailUrl: '/starter/world-a-night.webp',
          }],
        } : null,
        messages: [{
          id: 'assistant-slot',
          role: 'assistant' as const,
          createdAt: '2026-07-21T00:00:01.000Z',
          content: {
            emotion: 'happy' as const,
            inner_heart: '',
            response: '좋은 밤이네요.',
            character_image_slot: 'happy',
            world_image_slot: 'night',
          },
        }],
      },
    })

    render(<RoomPage chrome={chrome} roomId={room.id} />)

    const conversationInfo = await screen.findByRole('complementary', { name: '대화 정보' })
    expect(within(conversationInfo).getByRole('img', { name: '캐릭터A' }).getAttribute('src')).toBe('/starter/character-a-happy.webp')
    expect(within(conversationInfo).getByRole('img', { name: '월드A 월드 배경' }).getAttribute('src')).toBe('/starter/world-a-night.webp')
  })
})
