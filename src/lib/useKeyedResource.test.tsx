import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useKeyedResource } from '@/lib/useKeyedResource'

const Probe = ({ resourceKey, load }: { resourceKey: string; load: (signal: AbortSignal) => Promise<string> }) => {
  const resource = useKeyedResource(resourceKey, load)
  return <p>{resource.status === 'success' ? resource.data : resource.status}</p>
}

describe('keyed resource boundary', () => {
  it('aborts the previous key and never publishes its stale result', async () => {
    let resolveFirst: ((value: string) => void) | undefined
    let resolveSecond: ((value: string) => void) | undefined
    const signals: AbortSignal[] = []
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1
        ? new Promise<string>((resolve) => { resolveFirst = resolve })
        : new Promise<string>((resolve) => { resolveSecond = resolve })
    })
    const view = render(<Probe resourceKey="first" load={load} />)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))

    view.rerender(<Probe resourceKey="second" load={load} />)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(signals[0].aborted).toBe(true)

    await act(async () => {
      resolveFirst?.('stale')
      resolveSecond?.('current')
      await Promise.resolve()
    })
    expect(screen.getByText('current')).toBeTruthy()
    expect(screen.queryByText('stale')).toBeNull()
  })
})
