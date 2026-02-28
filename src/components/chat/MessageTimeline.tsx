import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { Heart } from "lucide-react"
import type { AIResponse } from "@/lib/data"
import type { PreparedChatMessage } from "@/lib/chat/messagePresentation"
import type { RefObject } from "react"

interface MessageTimelineProps {
  timelineId?: string
  scrollRef: RefObject<HTMLDivElement>
  preparedMessages: PreparedChatMessage[]
  characterName: string
  isLoading: boolean
  emotionLabels: Record<AIResponse["emotion"], string>
}

export function MessageTimeline({
  timelineId,
  scrollRef,
  preparedMessages,
  characterName,
  isLoading,
  emotionLabels,
}: MessageTimelineProps) {
  return (
    <div
      id={timelineId}
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      className="min-h-0 flex-1 overflow-y-auto px-3 py-4 scroll-smooth sm:px-4 lg:px-8 lg:py-6"
    >
      <div className="mx-auto w-full max-w-[980px] space-y-5">
        <p className="mx-auto w-fit rounded-full border border-white/45 bg-white/58 px-3 py-1 text-center text-xs font-semibold text-[#70695f]">
          이 대화는 AI로 생성된 가상의 이야기입니다
        </p>

        {preparedMessages.map(({ msg, isUser, content, innerHeart, narration, emotion, showIllustrationCard, messageImage }) => (
          <article
            key={msg.id}
            aria-label={isUser ? "내 메시지" : `${characterName} 메시지`}
            className={cn("fade-in flex w-full", isUser ? "justify-end" : "justify-start")}
          >
            <div className={cn("flex w-full gap-3", isUser ? "max-w-[84%] flex-row-reverse sm:max-w-[76%]" : "max-w-[92%] sm:max-w-[84%]")}>
              {!isUser && (
                <Avatar
                  src={messageImage}
                  alt={characterName}
                  fallback={characterName[0]}
                  className="mt-1 size-9 shrink-0 border border-black/10 object-cover object-top"
                />
              )}

              <div className="min-w-0 flex-1 space-y-2">
                <p className={cn("px-1 text-[11px] font-semibold", isUser ? "text-right text-[#70688a]" : "text-[#6b6474]")}>
                  {isUser ? "나" : `${characterName}${emotion ? ` · ${emotionLabels[emotion]}` : ""}`}
                </p>

                {showIllustrationCard && emotion && (
                  <div className="w-full max-w-[760px] overflow-hidden rounded-2xl border border-white/65 bg-white/92 shadow-[0_20px_34px_-24px_rgba(24,23,20,0.72)]">
                    <img
                      src={messageImage}
                      alt={`${characterName} ${emotion}`}
                      className="h-[260px] w-full object-cover object-top sm:h-[360px] lg:h-[440px]"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="border-t border-black/5 bg-[#f6f1e9] px-3 py-2 text-[11px] font-semibold text-[#5f584d]">
                      {characterName} · {emotionLabels[emotion]}
                    </div>
                  </div>
                )}

                {!isUser && narration && (
                  <div className="rounded-xl border border-[#ddd1bf] bg-[#f7f1e6]/96 px-3 py-2 text-sm leading-relaxed text-[#4f493f]">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#85796a]">상황</p>
                    <p className="whitespace-pre-wrap">{narration}</p>
                  </div>
                )}

                <div
                  className={cn(
                    "rounded-2xl border px-4 py-3 text-[15px] leading-7 shadow-[0_12px_24px_-18px_rgba(34,35,43,0.34)]",
                    isUser
                      ? "rounded-br-sm border-[#2f3140] bg-gradient-to-br from-[#4f4370] to-[#3a344f] text-[#fbfaf7]"
                      : "rounded-bl-sm border-[#d9cfbf] bg-[#fcf9f2] text-[#1f222a]"
                  )}
                >
                  {!isUser && innerHeart && (
                    <div className="mb-3 rounded-xl border border-[#d8cde7] bg-[#f7eefc]/96 px-3 py-2">
                      <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7d5f79]">
                        <Heart className="h-3 w-3" />
                        속마음
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#5d445b]">{innerHeart}</p>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{content}</div>
                </div>
              </div>
            </div>
          </article>
        ))}

        {isLoading && (
          <div className="fade-in flex justify-start" role="status" aria-live="polite">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[#d9cfbf] bg-[#fbf8f2]/96 px-4 py-2.5 text-sm text-[#6a645a] shadow-[0_12px_22px_-20px_rgba(0,0,0,0.65)]">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8f8aa8] [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8f8aa8] [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8f8aa8]" />
              <span className="ml-1 text-xs font-semibold text-[#7f786e]">답변 작성 중...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
