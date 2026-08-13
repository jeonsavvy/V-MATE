import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ChatQuota, RoomSummary } from '@/lib/platform/types'
import { PlatformApiError, platformApi } from '@/lib/platform/apiClient'
import { Button } from '@/components/ui/button'
import { ArtworkFrame, EmptyState, LoadingState } from '@/components/platform/PlatformScaffold'
import { ChatComposer } from '@/components/platform/ChatComposer'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'
import { PageFrame, ProtectedGate, safeActionError } from '@/components/platform/shared/PageFrame'
const NarrativeMessage = ({ message }: { message: RoomSummary['messages'][number] }) => {
  if (message.role === 'user') {
    return <div className="flex justify-end"><p className="max-w-[84%] whitespace-pre-wrap break-words rounded-[14px_14px_3px_14px] bg-[#f1f1f1] px-4 py-3 text-sm leading-7 text-[#171717]">{message.content as string}</p></div>
  }
  const payload = message.content as Extract<RoomSummary['messages'][number]['content'], object>
  return (
    <div className="space-y-3 border-b border-[#eeeeee] py-4 last:border-b-0">
      {payload.narration ? <p className="whitespace-pre-wrap break-words text-sm italic leading-7 text-[#666]">{payload.narration}</p> : null}
      <p className="whitespace-pre-wrap break-words text-base leading-8 text-[#171717]">{payload.response}</p>
      {payload.inner_heart ? <details className="rounded-md bg-[#f7f7f7] px-3 py-2 text-sm text-[#666]"><summary className="cursor-pointer font-semibold text-[#555]">속마음 보기</summary><p className="mt-2 whitespace-pre-wrap break-words leading-6">{payload.inner_heart}</p></details> : null}
    </div>
  )
}

const isViewportNearDocumentBottom = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true
  return document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) <= 160
}

// 시작 URL은 상세 화면으로 정규화해 링크 형태만 다르고 핵심 경험은 하나로 유지한다.
export function StartCharacterPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  useEffect(() => {
    chrome.onNavigate(`/characters/${slug}`)
  }, [chrome, slug])
  return <PageFrame chrome={chrome}><LoadingState label="캐릭터로 이동 중…" /></PageFrame>
}

export function StartWorldPage({ chrome, slug }: { chrome: PlatformPageChromeProps; slug: string }) {
  useEffect(() => {
    chrome.onNavigate(`/worlds/${slug}`)
  }, [chrome, slug])
  return <PageFrame chrome={chrome}><LoadingState label="월드로 이동 중…" /></PageFrame>
}

// 플레이 룸은 메시지, 상태 요약, 이미지 슬롯 반영을 같은 세션 모델로 묶는다.
export function RoomPage({ chrome, roomId }: { chrome: PlatformPageChromeProps; roomId: string }) {
  const [room, setRoom] = useState<RoomSummary | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [needsRetry, setNeedsRetry] = useState(false)
  const [quota, setQuota] = useState<ChatQuota | null>(null)
  const [quotaError, setQuotaError] = useState('')
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null)
  const isSendingRef = useRef(false)
  const roomScopeEpochRef = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const hasPositionedInitialMessagesRef = useRef(false)
  const previousMessageCountRef = useRef(0)
  const shouldFollowMessagesRef = useRef(true)

  useEffect(() => {
    roomScopeEpochRef.current += 1
    isSendingRef.current = false
    setRoom(null)
    setInput('')
    setQuota(null)
    setPendingRequestId(null)
    setNeedsRetry(false)
    setIsLoading(false)
    setLoadError('')
    setQuotaError('')
    hasPositionedInitialMessagesRef.current = false
    previousMessageCountRef.current = 0
    shouldFollowMessagesRef.current = true
  }, [chrome.user?.id, roomId])

  useEffect(() => {
    const updateFollowState = () => {
      shouldFollowMessagesRef.current = isViewportNearDocumentBottom()
    }
    updateFollowState()
    window.addEventListener('scroll', updateFollowState, { passive: true })
    return () => window.removeEventListener('scroll', updateFollowState)
  }, [chrome.user?.id, roomId])

  useEffect(() => {
    if (!chrome.user) return
    let mounted = true
    const scopeEpoch = roomScopeEpochRef.current
    setLoadError('')
    setQuotaError('')
    void platformApi.fetchRoom(roomId)
      .then(({ room }) => { if (mounted && scopeEpoch === roomScopeEpochRef.current) setRoom(room) })
      .catch(() => { if (mounted && scopeEpoch === roomScopeEpochRef.current) setLoadError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.') })
    void platformApi.fetchChatQuota()
      .then(({ quota }) => { if (mounted && scopeEpoch === roomScopeEpochRef.current) setQuota(quota) })
      .catch(() => { if (mounted && scopeEpoch === roomScopeEpochRef.current) setQuotaError('사용량을 불러오지 못했습니다. 메시지를 보내면 서버에서 한도를 확인합니다.') })
    return () => { mounted = false }
  }, [chrome.user?.id, roomId, reloadVersion])

  useEffect(() => {
    if (!room) return
    const isInitialPosition = !hasPositionedInitialMessagesRef.current
    const hasNewMessages = room.messages.length > previousMessageCountRef.current
    const shouldScroll = isInitialPosition || (hasNewMessages && shouldFollowMessagesRef.current)
    hasPositionedInitialMessagesRef.current = true
    previousMessageCountRef.current = room.messages.length
    if (!shouldScroll) return

    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView?.({ block: 'end', behavior: isInitialPosition ? 'auto' : 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [room?.id, room?.messages.length])

  const activeCharacterImage = useMemo(() => {
    if (!room) return ''
    const latestAssistant = [...room.messages].reverse().find((message) => message.role === 'assistant' && typeof message.content === 'object')
    const content = latestAssistant && typeof latestAssistant.content === 'object' ? latestAssistant.content : null
    const explicitSlot = content?.character_image_slot?.trim()
    const emotion = content?.emotion || 'normal'
    const slots = room.character.imageSlots || []
    if (explicitSlot) {
      const matched = slots.find((slot) => slot.slot === explicitSlot)
      if (matched) {
        return matched.detailUrl || matched.cardUrl || room.character.coverImageUrl
      }
    }
    const selected =
      slots.find((slot) => slot.slot === emotion) ||
      slots.find((slot) => slot.slot === 'normal') ||
      slots.find((slot) => slot.slot === 'main')
    return selected?.detailUrl || room.character.avatarImageUrl || room.character.coverImageUrl
  }, [room])

  const activeWorldImage = useMemo(() => {
    if (!room?.world) return ''
    const latestAssistant = [...room.messages].reverse().find((message) => message.role === 'assistant' && typeof message.content === 'object')
    const explicitSlot = latestAssistant && typeof latestAssistant.content === 'object'
      ? latestAssistant.content.world_image_slot?.trim()
      : ''
    const slots = room.world.imageSlots || []
    if (explicitSlot) {
      const matched = slots.find((slot) => slot.slot === explicitSlot)
      if (matched) {
        return matched.detailUrl || matched.cardUrl || room.world.coverImageUrl
      }
    }
    return slots.find((slot) => slot.slot === 'main')?.detailUrl || room.world.coverImageUrl
  }, [room])

  const sendMessage = () => {
    const messageToSend = input.trim()
    if (!room || !messageToSend || isSendingRef.current || quota?.remaining === 0) return

    const requestId = pendingRequestId || crypto.randomUUID()
    const scopeEpoch = roomScopeEpochRef.current
    shouldFollowMessagesRef.current = isViewportNearDocumentBottom()
    isSendingRef.current = true
    setPendingRequestId(requestId)
    setNeedsRetry(false)
    setIsLoading(true)
    void platformApi.sendRoomMessage(room.id, messageToSend, requestId)
      .then((payload) => {
        if (scopeEpoch !== roomScopeEpochRef.current) return
        setRoom(payload.room)
        setQuota(payload.quota)
        setInput('')
        setPendingRequestId(null)
        setNeedsRetry(false)
      })
      .catch((error) => {
        if (scopeEpoch !== roomScopeEpochRef.current) return
        const typedError = error instanceof PlatformApiError ? error : null
        // 응답이 불확실한 실패 뒤에는 같은 ID로 재시도해 이미 반영된 turn을
        // replay한다. 현재 입력에 이 ID를 쓸 수 없다는 명시적 충돌만 폐기한다.
        if (typedError?.code === 'CLIENT_REQUEST_ID_CONFLICT') setPendingRequestId(null)
        if (typedError?.code === 'CHAT_REQUEST_IN_PROGRESS') {
          if (typedError.details?.quota) setQuota(typedError.details.quota)
          setNeedsRetry(true)
          toast.error('메시지를 처리 중입니다. 잠시 후 다시 보내 주세요.')
          return
        }
        if (typedError?.code === 'CHAT_DAILY_LIMIT_EXCEEDED') {
          if (typedError.details?.quota) setQuota(typedError.details.quota)
          toast.error('오늘 보낼 수 있는 메시지를 모두 사용했습니다.')
          return
        }
        setNeedsRetry(true)
        toast.error(safeActionError(error, '메시지를 보내지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.'))
      })
      .finally(() => {
        if (scopeEpoch !== roomScopeEpochRef.current) return
        isSendingRef.current = false
        setIsLoading(false)
      })
  }

  if (!chrome.user) {
    return <ProtectedGate chrome={chrome} title="로그인이 필요합니다" description="로그인하면 대화를 이어서 저장할 수 있습니다." />
  }

  return (
    <PageFrame chrome={chrome} showCombinationDock={false}>
      {!room ? (
        loadError ? <EmptyState title="대화를 불러오지 못했습니다" description={loadError} action={<Button onClick={() => setReloadVersion((value) => value + 1)}>다시 불러오기</Button>} /> : <LoadingState label="대화 불러오는 중…" />
      ) : (
        <div className="mx-auto max-w-[960px] space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-[#e7e7e7] pb-5">
              <div>
                <h1 className="text-2xl font-bold tracking-[-0.04em] text-[#171717]">{room.title}</h1>
                <p className="mt-1 text-sm text-[#666]">{room.userAlias} · {room.character.name}{room.world ? ` · ${room.world.name}` : ''}</p>
              </div>
              <Button variant="ghost" className="shrink-0 text-[#666]" onClick={() => chrome.onNavigate(room.world ? `/worlds/${room.world.slug}` : `/characters/${room.character.slug}`)}>
                <ArrowLeft className="h-4 w-4" />{room.world ? '월드 보기' : '캐릭터 보기'}
              </Button>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="border-b border-[#e7e7e7] pb-4 lg:sticky lg:top-24 lg:rounded-lg lg:border lg:p-3" aria-label="대화 정보">
              <div className="hidden lg:block">
                <ArtworkFrame src={activeCharacterImage} alt={room.character.name} aspectClassName="aspect-[4/5]" className="rounded-md" priority />
              </div>
              <div className="flex items-start gap-3 lg:mt-3">
                <ArtworkFrame src={activeCharacterImage} alt="" aspectClassName="aspect-square" className="size-16 shrink-0 rounded-md lg:hidden" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#171717]">{room.character.name}</p>
                  {room.world ? <p className="mt-0.5 truncate text-xs text-[#666]">{room.world.name}</p> : null}
                  <p className="mt-1 text-xs leading-5 text-[#666]">{room.state.currentSituation}</p>
                </div>
              </div>
              {room.world && activeWorldImage ? (
                <div className="mt-3 hidden border-t border-[#eeeeee] pt-3 lg:block">
                  <p className="mb-2 text-xs font-semibold text-[#666]">월드 · {room.world.name}</p>
                  <ArtworkFrame src={activeWorldImage} alt={`${room.world.name} 월드 배경`} aspectClassName="aspect-[16/9]" className="rounded-md" />
                </div>
              ) : null}
            </aside>

            <div className="min-w-0">
              <section aria-label="대화 메시지" className="min-h-[240px] space-y-4 py-1">
                  {room.messages.map((message) => <NarrativeMessage key={message.id} message={message} />)}
                  {isLoading ? <div role="status" className="text-sm text-[#666]"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />응답 작성 중…</div> : null}
              </section>

              <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] z-20 bg-white pb-2 lg:bottom-0">
                {quotaError ? <p role="status" className="mb-2 text-xs text-[#666]">{quotaError} <button type="button" className="underline" onClick={() => { setQuotaError(''); void platformApi.fetchChatQuota().then(({ quota }) => setQuota(quota)).catch(() => setQuotaError('사용량을 다시 불러오지 못했습니다.')) }}>다시 시도</button></p> : null}
                <ChatComposer
                  value={input}
                  onChange={(value) => {
                    if (value !== input) {
                      setPendingRequestId(null)
                      if (needsRetry) setNeedsRetry(false)
                    }
                    setInput(value)
                  }}
                  onSubmit={sendMessage}
                  isSending={isLoading}
                  quota={quota}
                  needsRetry={needsRetry}
                />
              </div>
              <div ref={messagesEndRef} aria-hidden="true" className="h-px" />
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  )
}
