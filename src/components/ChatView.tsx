import { Character, AIResponse } from "@/lib/data"
import { cn } from "@/lib/utils"
import { CHARACTER_UI_META } from "@/lib/character-ui"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { useChatViewController } from "@/hooks/useChatViewController"
import { ChatComposer } from "@/components/chat/ChatComposer"
import { CharacterInfoDesktop } from "@/components/chat/CharacterInfoDesktop"
import { CharacterInfoMobile } from "@/components/chat/CharacterInfoMobile"
import { CharacterSidebar } from "@/components/chat/CharacterSidebar"
import { ChatTopBar } from "@/components/chat/ChatTopBar"
import { MessageTimeline } from "@/components/chat/MessageTimeline"
import { ClearChatDialog } from "@/components/chat/ClearChatDialog"
import { useState } from "react"

interface ChatViewProps {
  character: Character
  onCharacterChange: (charId: string) => void
  user: SupabaseUser | null
  onBack: () => void
}

const EMOTION_LABELS: Record<AIResponse["emotion"], string> = {
  normal: "기본 표정",
  happy: "기분 좋아짐",
  confused: "당황한 표정",
  angry: "감정 고조",
}

const QUICK_REPLY_TEMPLATES = ["계속 말해줘", "조금 더 자세히 알려줘", "다른 전개로 이어가줘"]

export function ChatView({ character, onCharacterChange, user, onBack }: ChatViewProps) {
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [isClearSubmitting, setIsClearSubmitting] = useState(false)

  const {
    inputValue,
    setInputValue,
    isLoading,
    showEmotionIllustrations,
    setShowEmotionIllustrations,
    isInfoPanelOpen,
    setIsInfoPanelOpen,
    scrollRef,
    messageInputRef,
    sidebarCharacterEntries,
    preparedMessages,
    activeEmotion,
    handleSendMessage,
    handleClearChat,
    handleInputKeyDown,
    handleQuickReplyClick,
  } = useChatViewController({ character, user })

  const characterMeta = CHARACTER_UI_META[character.id]
  const activeEmotionLabel = EMOTION_LABELS[activeEmotion]

  return (
    <div className="relative h-dvh overflow-hidden bg-[#e7dfd3] text-[#22242b]">
      <a
        href="#chat-message-list"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#2f3138]"
      >
        메시지 영역으로 건너뛰기
      </a>
      <a
        href="#chat-composer"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-16 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#2f3138]"
      >
        입력 영역으로 건너뛰기
      </a>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(123,109,140,0.14),transparent_36%),radial-gradient(circle_at_84%_85%,rgba(112,139,160,0.1),transparent_34%)]" />

      <div
        className={cn(
          "relative z-10 mx-auto grid h-full min-h-0 w-full max-w-[1680px] lg:grid-cols-[300px_minmax(0,1fr)]",
          isInfoPanelOpen && "xl:grid-cols-[300px_minmax(0,1fr)_320px]"
        )}
      >
        <CharacterSidebar
          entries={sidebarCharacterEntries}
          activeCharacterId={character.id}
          onCharacterChange={onCharacterChange}
        />

        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <ChatTopBar
            character={character}
            characterTags={characterMeta.tags}
            isInfoPanelOpen={isInfoPanelOpen}
            onBack={onBack}
            onToggleInfoPanel={() => setIsInfoPanelOpen((prev) => !prev)}
            onClearChat={() => setIsClearDialogOpen(true)}
            onCharacterChange={onCharacterChange}
          />

          <CharacterInfoMobile
            isOpen={isInfoPanelOpen}
            character={character}
            tags={characterMeta.tags}
            summary={characterMeta.summary}
            activeEmotionLabel={activeEmotionLabel}
            showEmotionIllustrations={showEmotionIllustrations}
            onToggleIllustrations={() => setShowEmotionIllustrations((prev) => !prev)}
          />

          <MessageTimeline
            timelineId="chat-message-list"
            scrollRef={scrollRef}
            preparedMessages={preparedMessages}
            characterName={character.name}
            isLoading={isLoading}
            emotionLabels={EMOTION_LABELS}
          />

          <ChatComposer
            composerId="chat-composer"
            inputValue={inputValue}
            isLoading={isLoading}
            activeEmotionLabel={activeEmotionLabel}
            characterName={character.name}
            quickReplyTemplates={QUICK_REPLY_TEMPLATES}
            messageInputRef={messageInputRef}
            onInputChange={setInputValue}
            onInputKeyDown={handleInputKeyDown}
            onSend={() => {
              void handleSendMessage()
            }}
            onQuickReplyClick={handleQuickReplyClick}
          />
        </div>

        <CharacterInfoDesktop
          isOpen={isInfoPanelOpen}
          character={character}
          tags={characterMeta.tags}
          summary={characterMeta.summary}
          heroQuote={characterMeta.heroQuote}
          activeEmotionLabel={activeEmotionLabel}
          showEmotionIllustrations={showEmotionIllustrations}
          onToggleIllustrations={() => setShowEmotionIllustrations((prev) => !prev)}
        />
      </div>

      <ClearChatDialog
        open={isClearDialogOpen}
        isSubmitting={isClearSubmitting}
        onOpenChange={setIsClearDialogOpen}
        onConfirm={() => {
          void (async () => {
            setIsClearSubmitting(true)
            const success = await handleClearChat()
            setIsClearSubmitting(false)
            if (success) {
              setIsClearDialogOpen(false)
            }
          })()
        }}
      />
    </div>
  )
}
