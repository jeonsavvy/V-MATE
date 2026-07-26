import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('renders one character slot, one optional world slot, and blocks an incomplete combination', () => {
    const onStart = vi.fn(async () => undefined)
    render(
      <PlatformShell
        user={null}
        authStatus="anonymous"
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
    expect((startButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(startButton)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('starts from the same dock once a character is selected', () => {
    const onStart = vi.fn(async () => undefined)
    const selectedCharacter: CharacterSummary = {
      ...baseEntity,
      id: 'character-a',
      entityType: 'character',
      slug: 'character-a-test',
      name: '캐릭터A',
      coverImageUrl: '/starter/character-a.webp',
      avatarImageUrl: '/starter/character-a.webp',
    }
    render(
      <PlatformShell
        user={null}
        authStatus="anonymous"
        userAvatarInitial="V"
        onNavigate={vi.fn()}
        onAuthRequest={vi.fn()}
        onSignOut={vi.fn()}
        onDeleteAccount={vi.fn(async () => undefined)}
        selectedCharacter={selectedCharacter}
        onStartCombination={onStart}
      >
        <p>본문</p>
      </PlatformShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: '대화 시작' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('keeps the dock out of chat and create screens when disabled', () => {
    render(
      <PlatformShell
        user={null}
        authStatus="anonymous"
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

describe('PlatformShell account dialog', () => {
  const renderAuthenticatedShell = (onDeleteAccount = vi.fn(async () => undefined)) => render(
    <PlatformShell
      user={{ id: 'user-1', email: 'user@example.com', user_metadata: { name: '사용자' } } as never}
      authStatus="authenticated"
      userAvatarInitial="사"
      onNavigate={vi.fn()}
      onAuthRequest={vi.fn()}
      onSignOut={vi.fn(async () => undefined)}
      onDeleteAccount={onDeleteAccount}
      showCombinationDock={false}
    >
      <p>본문</p>
    </PlatformShell>,
  )

  it('does not show a login action while authentication is still being checked', () => {
    render(
      <PlatformShell
        user={null}
        authStatus="checking"
        userAvatarInitial="V"
        onNavigate={vi.fn()}
        onAuthRequest={vi.fn()}
        onSignOut={vi.fn()}
        onDeleteAccount={vi.fn(async () => undefined)}
        showCombinationDock={false}
      >
        <p>본문</p>
      </PlatformShell>,
    )

    expect(screen.queryByRole('button', { name: '로그인' })).toBeNull()
    expect(screen.getAllByRole('status', { name: '로그인 상태 확인 중' }).length).toBeGreaterThan(0)
  })

  it('keeps unavailable authentication distinct from the anonymous login CTA', () => {
    render(
      <PlatformShell
        user={null}
        authStatus="unavailable"
        userAvatarInitial="V"
        onNavigate={vi.fn()}
        onAuthRequest={vi.fn()}
        onSignOut={vi.fn()}
        onDeleteAccount={vi.fn(async () => undefined)}
        showCombinationDock={false}
      >
        <p>본문</p>
      </PlatformShell>,
    )

    expect(screen.queryByRole('button', { name: '로그인' })).toBeNull()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('현재 로그인 상태는 확인되지 않았습니다'))).toBe(true)
    expect(screen.getAllByRole('button', { name: '인증 다시 확인' }).length).toBeGreaterThan(0)
  })

  it('shares an accessible account dialog across desktop and mobile triggers and restores focus', async () => {
    const user = userEvent.setup()
    const { container } = renderAuthenticatedShell()
    const trigger = screen.getByRole('button', { name: '계정 메뉴 열기' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '계정' })
    expect(within(dialog).getByRole('button', { name: '보관함' }).className).toContain('min-h-11')
    expect(within(dialog).getByRole('button', { name: '운영실' }).className).toContain('min-h-11')
    expect(container.querySelector('nav.grid-cols-5')).toBeTruthy()
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '계정' })).toBeNull())
    expect(document.activeElement).toBe(trigger)

    const mobileTrigger = screen.getByRole('button', { name: '모바일 계정 메뉴 열기' })
    await user.click(mobileTrigger)
    expect(screen.getByRole('dialog', { name: '계정' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '계정' })).toBeNull())
    expect(document.activeElement).toBe(mobileTrigger)
  })

  it('blocks duplicate account deletion and retains confirmation and dialog state on failure', async () => {
    let rejectDelete: ((reason: Error) => void) | undefined
    const onDeleteAccount = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectDelete = reject }))
    const user = userEvent.setup()
    renderAuthenticatedShell(onDeleteAccount)

    await user.click(screen.getByRole('button', { name: '계정 메뉴 열기' }))
    await user.click(screen.getByRole('button', { name: '계정 탈퇴' }))
    const confirmation = screen.getByLabelText('계정 탈퇴 확인 문구') as HTMLInputElement
    await user.type(confirmation, '탈퇴')
    const deleteButton = screen.getByRole('button', { name: '영구 탈퇴' })
    await user.click(deleteButton)
    await user.click(deleteButton)
    expect(onDeleteAccount).toHaveBeenCalledTimes(1)

    rejectDelete?.(new Error('SUPABASE_SERVICE_ROLE_KEY stack trace'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('현재 계정과 콘텐츠 상태를 확인한 뒤'))
    expect(screen.getByRole('alert').textContent).not.toMatch(/SUPABASE|stack/i)
    expect(confirmation.value).toBe('탈퇴')
    expect((screen.getByRole('button', { name: '영구 탈퇴' }) as HTMLButtonElement).disabled).toBe(false)
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
    expect(image.getAttribute('srcset')).toContain('/starter/character-a-feed-v2.webp 400w')
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
