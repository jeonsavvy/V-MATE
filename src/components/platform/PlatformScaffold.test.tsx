import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntityCard, PlatformShell } from '@/components/platform/PlatformScaffold'
import type { CharacterSummary, WorldSummary } from '@/lib/platform/types'

const baseEntity = {
  headline: '한 줄 소개',
  summary: '소개',
  tags: ['테스트'],
  creator: { id: 'creator-1', slug: 'creator', name: 'V-MATE' },
  visibility: 'public' as const,
  displayStatus: 'visible' as const,
  sourceType: 'original',
  favoriteCount: 0,
  chatStartCount: 0,
  updatedAt: '2026-07-21T00:00:00.000Z',
}

afterEach(cleanup)

describe('PlatformShell combination dock', () => {
  it('renders one character slot, one optional world slot, and the start CTA', () => {
    const onStart = vi.fn(async () => undefined)
    render(
      <PlatformShell
        user={null}
        userAvatarInitial="V"
        onNavigate={vi.fn()}
        onAuthRequest={vi.fn()}
        onSignOut={vi.fn()}
        onDeleteAccount={vi.fn(async () => undefined)}
        onStartCombination={onStart}
      >
        <p>본문</p>
      </PlatformShell>,
    )

    expect(screen.getByText('캐릭터 선택')).toBeTruthy()
    expect(screen.getByText('월드 선택')).toBeTruthy()
    const startButton = screen.getByRole('button', { name: /캐릭터를 선택하세요/ })
    fireEvent.click(startButton)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('keeps the dock out of chat and create screens when disabled', () => {
    render(
      <PlatformShell
        user={null}
        userAvatarInitial="V"
        onNavigate={vi.fn()}
        onAuthRequest={vi.fn()}
        onSignOut={vi.fn()}
        onDeleteAccount={vi.fn(async () => undefined)}
        showCombinationDock={false}
      >
        <p>채팅</p>
      </PlatformShell>,
    )
    expect(screen.queryByRole('button', { name: /캐릭터를 선택하세요/ })).toBeNull()
  })
})

describe('EntityCard artwork delivery', () => {
  it('uses responsive official starter variants and prioritizes the first card image', () => {
    const item: CharacterSummary = {
      ...baseEntity,
      id: 'character-a',
      entityType: 'character',
      slug: 'character-a-test',
      name: '캐릭터A',
      coverImageUrl: '/starter/character-a.webp',
      avatarImageUrl: '/starter/character-a.webp',
    }

    render(<EntityCard item={item} priority onClick={vi.fn()} />)
    const image = screen.getByRole('img', { name: '캐릭터A' })
    expect(image.getAttribute('src')).toBe('/starter/character-a-card-v1.webp')
    expect(image.getAttribute('srcset')).toContain('/starter/character-a-thumb-v1.webp 300w')
    expect(image.getAttribute('srcset')).toContain('/starter/character-a-detail-v1.webp 768w')
    expect(image.getAttribute('sizes')).toBe('(min-width: 1024px) 520px, 50vw')
    expect(image.getAttribute('fetchpriority')).toBe('high')
    expect(image.getAttribute('loading')).toBe('eager')
  })

  it('prefers generated card slots over a full-size world cover', () => {
    const item: WorldSummary = {
      ...baseEntity,
      id: 'world-1',
      entityType: 'world',
      slug: 'world-1',
      name: '월드',
      coverImageUrl: 'https://example.com/world-hero.webp',
      imageSlots: [{
        id: 'main',
        slot: 'main',
        usage: '대표',
        trigger: '',
        priority: 0,
        thumbUrl: 'https://example.com/world-thumb.webp',
        cardUrl: 'https://example.com/world-card.webp',
        detailUrl: 'https://example.com/world-hero.webp',
      }],
    }

    render(<EntityCard item={item} onClick={vi.fn()} />)
    const image = screen.getByRole('img', { name: '월드' })
    expect(image.getAttribute('src')).toBe('https://example.com/world-card.webp')
    expect(image.getAttribute('srcset')).toContain('https://example.com/world-thumb.webp 320w')
    expect(image.getAttribute('srcset')).toContain('https://example.com/world-hero.webp 1280w')
    expect(image.getAttribute('loading')).toBe('lazy')
  })
})
