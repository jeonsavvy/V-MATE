import { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatQuota } from '@/lib/platform/types'

interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  isSending: boolean
  quota: ChatQuota | null
  needsRetry?: boolean
}

const formatResetTime = (resetAt: string) => new Date(resetAt).toLocaleTimeString('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
})

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  isSending,
  quota,
  needsRetry = false,
}: ChatComposerProps) {
  const isComposing = useRef(false)
  const isDisabled = isSending || !value.trim() || quota?.remaining === 0

  const submit = () => {
    if (isDisabled) return
    onSubmit()
  }

  return (
    <div className="space-y-3 border-t border-[#e7e7e7] pt-5">
      <label htmlFor="chat-message" className="sr-only">메시지</label>
      <textarea
        id="chat-message"
        name="message"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => { isComposing.current = true }}
        onCompositionEnd={() => { isComposing.current = false }}
        onKeyDown={(event) => {
          const nativeEvent = event.nativeEvent
          const compositionActive = isComposing.current || nativeEvent.isComposing || nativeEvent.keyCode === 229
          if (event.key !== 'Enter' || event.shiftKey || compositionActive) return
          event.preventDefault()
          submit()
        }}
        placeholder="메시지를 입력하세요…"
        rows={3}
        autoComplete="off"
        className="min-h-[92px] max-h-[240px] w-full resize-y rounded-lg border border-[#dedede] bg-white px-4 py-3 text-[15px] leading-7 text-[#171717] transition placeholder:text-[#aaa] focus-visible:border-[#999] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5148]/30 focus-visible:ring-offset-2"
      />
      {needsRetry ? (
        <p role="status" className="rounded-lg border border-[#e7d9c8] bg-[#fffaf3] px-4 py-3 text-sm text-[#5f5551]">
          응답을 받지 못했습니다. 입력한 메시지는 그대로 두었습니다.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {quota ? (
          <p className={`text-xs ${quota.remaining === 0 ? 'font-semibold text-[#b22f2a]' : 'text-[#777]'}`}>
            {quota.remaining === 0
              ? `오늘 보낼 수 있는 메시지를 모두 사용했습니다. ${formatResetTime(quota.resetAt)} 초기화`
              : `남은 메시지 ${quota.remaining}/${quota.limit} · ${formatResetTime(quota.resetAt)} 초기화`}
          </p>
        ) : <span />}
        <Button
          className="min-w-24 bg-[#ff5148] text-white shadow-none hover:bg-[#e94740]"
          disabled={isDisabled}
          onClick={submit}
        >
          {isSending ? <Loader2 className="size-4 animate-spin" /> : null}
          {needsRetry ? '다시 보내기' : '보내기'}
        </Button>
      </div>
    </div>
  )
}
