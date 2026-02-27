import { Button } from "@/components/ui/button"
import { Send, Sparkles } from "lucide-react"
import type { KeyboardEvent, RefObject } from "react"
import { CHAT_REQUEST_LIMITS } from "@/lib/chat/chatContract"

interface ChatComposerProps {
  composerId?: string
  inputValue: string
  isLoading: boolean
  activeEmotionLabel: string
  characterName: string
  quickReplyTemplates: string[]
  messageInputRef: RefObject<HTMLTextAreaElement>
  onInputChange: (value: string) => void
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onQuickReplyClick: (template: string) => void
}

export function ChatComposer({
  composerId,
  inputValue,
  isLoading,
  activeEmotionLabel,
  characterName,
  quickReplyTemplates,
  messageInputRef,
  onInputChange,
  onInputKeyDown,
  onSend,
  onQuickReplyClick,
}: ChatComposerProps) {
  return (
    <div id={composerId} className="border-t border-white/45 bg-[#ece4d8]/84 px-3 pb-[calc(0.95rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:px-4 lg:px-8 lg:pb-[calc(1.1rem+env(safe-area-inset-bottom))] lg:pt-4">
      <div className="mx-auto w-full max-w-[980px]">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-white/45 bg-white/70 px-3 py-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5e5862]">
            <Sparkles className="h-3.5 w-3.5 text-[#7b5cb8]" />
            {isLoading ? `${characterName}이(가) 답변을 작성하고 있어요` : `${characterName}과 이어서 대화해보세요`}
          </div>
          <span className="rounded-full bg-[#f2ecff] px-2 py-1 text-[11px] font-semibold text-[#6a5991]">{activeEmotionLabel}</span>
        </div>

        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="빠른 답장">
          {quickReplyTemplates.map((template) => (
            <button
              key={template}
              type="button"
              onClick={() => onQuickReplyClick(template)}
              disabled={isLoading}
              className="rounded-full border border-[#d8cebe] bg-white/82 px-3 py-1.5 text-xs font-semibold text-[#615b51] transition hover:border-[#cfbce9] hover:text-[#3b3c43] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {template}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2 rounded-2xl border border-[#d8cdbe] bg-[#f7f2ea]/92 p-2.5 shadow-[0_16px_28px_-20px_rgba(32,31,27,0.55)] transition focus-within:border-[#8b6cc7] focus-within:shadow-[0_18px_30px_-18px_rgba(76,58,122,0.55)]">
          <textarea
            ref={messageInputRef}
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={isLoading ? "답변 생성 중입니다..." : "메시지를 입력하세요"}
            aria-label={`${characterName}에게 보낼 메시지`}
            aria-describedby="chat-composer-hint"
            disabled={isLoading}
            maxLength={CHAT_REQUEST_LIMITS.userMessageMaxChars}
            rows={1}
            className="max-h-[156px] min-h-[44px] flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 text-[#2a2c34] placeholder:text-[#847c73] outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            onClick={onSend}
            disabled={isLoading || !inputValue.trim()}
            className="h-11 shrink-0 rounded-xl bg-gradient-to-br from-[#4d3f74] to-[#3b3258] px-3 text-white shadow-[0_12px_22px_-14px_rgba(24,25,31,0.9)] hover:brightness-110 disabled:opacity-60"
          >
            <Send className="mr-1 h-4 w-4" />
            <span className="text-xs font-semibold">전송</span>
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-[#8f877b]">
          <p id="chat-composer-hint">Enter 전송 · Shift + Enter 줄바꿈</p>
          <span>{inputValue.length}/{CHAT_REQUEST_LIMITS.userMessageMaxChars}</span>
        </div>
      </div>
    </div>
  )
}
