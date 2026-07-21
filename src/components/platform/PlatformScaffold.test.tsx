import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlatformShell } from '@/components/platform/PlatformScaffold'

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
