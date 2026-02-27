import type { AIResponse, Character, Message } from "@/lib/data"

export interface PreparedChatMessage {
  msg: Message
  isUser: boolean
  content: string
  innerHeart: string | null
  narration: string
  emotion: AIResponse["emotion"] | undefined
  showIllustrationCard: boolean
  messageImage: string
}

export const resolveEmotionImage = (character: Character, emotion?: AIResponse["emotion"]) => {
  if (emotion === "confused" && character.images.confused) {
    return character.images.confused
  }
  if (emotion === "happy" && character.images.happy) {
    return character.images.happy
  }
  if (emotion === "angry") {
    return character.images.angry
  }
  return character.images.normal
}

export const prepareMessagesForRender = ({
  messages,
  character,
  showEmotionIllustrations,
}: {
  messages: Message[]
  character: Character
  showEmotionIllustrations: boolean
}): PreparedChatMessage[] => {
  let previousAssistantEmotion: AIResponse["emotion"] | null = null

  return messages.map((msg) => {
    const isUser = msg.role === "user"
    const assistantPayload = typeof msg.content === "string" ? null : msg.content
    const content = typeof msg.content === "string" ? msg.content : msg.content.response
    const innerHeart = assistantPayload?.inner_heart ?? null
    const narration = typeof assistantPayload?.narration === "string" ? assistantPayload.narration.trim() : ""
    const emotion = assistantPayload?.emotion
    const showIllustrationCard = Boolean(
      !isUser &&
      showEmotionIllustrations &&
      emotion &&
      previousAssistantEmotion &&
      emotion !== previousAssistantEmotion
    )
    const messageImage = resolveEmotionImage(character, emotion)

    if (!isUser && emotion) {
      previousAssistantEmotion = emotion
    }

    return {
      msg,
      isUser,
      content,
      innerHeart,
      narration,
      emotion,
      showIllustrationCard,
      messageImage,
    }
  })
}

export const getLatestAssistantPayload = (messages: Message[]): AIResponse | null => {
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((msg) => msg.role === "assistant" && typeof msg.content !== "string")

  if (!latestAssistantMessage || typeof latestAssistantMessage.content === "string") {
    return null
  }

  return latestAssistantMessage.content
}
