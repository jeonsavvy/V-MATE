import { useCallback, useEffect, useRef } from "react"

interface InFlightRequest {
  id: number
  characterId: string
  controller: AbortController
}

export const useChatSession = (characterId: string) => {
  const requestCounterRef = useRef(0)
  const inFlightRequestRef = useRef<InFlightRequest | null>(null)
  const activeCharacterIdRef = useRef(characterId)

  const abortInFlight = useCallback(() => {
    if (inFlightRequestRef.current) {
      inFlightRequestRef.current.controller.abort()
      inFlightRequestRef.current = null
    }
  }, [])

  useEffect(() => {
    activeCharacterIdRef.current = characterId
    abortInFlight()
  }, [characterId, abortInFlight])

  useEffect(() => {
    return () => {
      abortInFlight()
    }
  }, [abortInFlight])

  const beginRequest = useCallback((targetCharacterId: string) => {
    abortInFlight()
    const requestId = requestCounterRef.current + 1
    requestCounterRef.current = requestId
    const controller = new AbortController()
    inFlightRequestRef.current = {
      id: requestId,
      characterId: targetCharacterId,
      controller,
    }
    return { requestId, controller }
  }, [abortInFlight])

  const isRequestStale = useCallback((requestId: number, targetCharacterId: string) => {
    return (
      activeCharacterIdRef.current !== targetCharacterId ||
      inFlightRequestRef.current?.id !== requestId
    )
  }, [])

  const finishRequest = useCallback((requestId: number) => {
    if (inFlightRequestRef.current?.id === requestId) {
      inFlightRequestRef.current = null
    }
  }, [])

  return {
    beginRequest,
    isRequestStale,
    finishRequest,
    abortInFlight,
    inFlightRequestRef,
  }
}
