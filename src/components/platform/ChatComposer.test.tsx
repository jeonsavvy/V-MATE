import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ChatComposer } from '@/components/platform/ChatComposer'

afterEach(cleanup)

const quota = {
  limit: 30,
  remaining: 12,
  resetAt: '2026-07-22T00:00:00+09:00',
}

function ControlledComposer({ onSubmit = vi.fn(), remaining = 12 }: { onSubmit?: () => void; remaining?: number }) {
  const [value, setValue] = useState('테스트 메시지')
  return (
    <ChatComposer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      isSending={false}
      quota={{ ...quota, remaining }}
    />
  )
}

describe('ChatComposer', () => {
  it('sends with Enter and keeps Shift+Enter for a newline', () => {
    const onSubmit = vi.fn()
    render(<ControlledComposer onSubmit={onSubmit} />)
    const textarea = screen.getByLabelText('메시지')

    const shiftedEnter = createEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    fireEvent(textarea, shiftedEnter)
    expect(shiftedEnter.defaultPrevented).toBe(false)
    expect(onSubmit).not.toHaveBeenCalled()

    const enter = createEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent(textarea, enter)
    expect(enter.defaultPrevented).toBe(true)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not send while Korean IME composition is active', () => {
    const onSubmit = vi.fn()
    render(<ControlledComposer onSubmit={onSubmit} />)
    const textarea = screen.getByLabelText('메시지')

    fireEvent.compositionStart(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.compositionEnd(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('uses the same submit action for the send button', () => {
    const onSubmit = vi.fn()
    render(<ControlledComposer onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('disables sending when the daily quota is exhausted', () => {
    const onSubmit = vi.fn()
    render(<ControlledComposer onSubmit={onSubmit} remaining={0} />)
    const button = screen.getByRole('button', { name: '보내기' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('메시지'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
