import { useEffect, useReducer, useRef } from 'react'

export type KeyedResourceState<T> =
  | { status: 'idle'; key: null }
  | { status: 'loading'; key: string }
  | { status: 'success'; key: string; data: T }
  | { status: 'error'; key: string; error: unknown }

type ResourceAction<T> =
  | { type: 'idle' }
  | { type: 'loading'; key: string }
  | { type: 'success'; key: string; data: T }
  | { type: 'error'; key: string; error: unknown }

const reduceResource = <T,>(_state: KeyedResourceState<T>, action: ResourceAction<T>): KeyedResourceState<T> => {
  switch (action.type) {
    case 'idle': return { status: 'idle', key: null }
    case 'loading': return { status: 'loading', key: action.key }
    case 'success': return { status: 'success', key: action.key, data: action.data }
    case 'error': return { status: 'error', key: action.key, error: action.error }
  }
}

export const useKeyedResource = <T,>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): KeyedResourceState<T> => {
  const loaderRef = useRef(load)
  loaderRef.current = load
  const [state, dispatch] = useReducer(reduceResource<T>, { status: 'idle', key: null })

  useEffect(() => {
    if (key === null) {
      dispatch({ type: 'idle' })
      return
    }
    const controller = new AbortController()
    dispatch({ type: 'loading', key })
    void loaderRef.current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) dispatch({ type: 'success', key, data })
      })
      .catch((error) => {
        if (!controller.signal.aborted) dispatch({ type: 'error', key, error })
      })
    return () => controller.abort()
  }, [key])

  return state
}
