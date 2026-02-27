import type { AIResponse, Message } from "@/lib/data"

const ALLOWED_EMOTIONS = new Set<AIResponse["emotion"]>(["normal", "happy", "confused", "angry"])

export const sanitizeAssistantPayload = (value: unknown): AIResponse | null => {
  if (!value || typeof value !== "object") {
    return null
  }

  const payload = value as Record<string, unknown>
  const response = typeof payload.response === "string" ? payload.response.trim() : ""
  if (!response) {
    return null
  }

  const rawEmotion = typeof payload.emotion === "string" ? payload.emotion.toLowerCase().trim() : "normal"
  const emotion = ALLOWED_EMOTIONS.has(rawEmotion as AIResponse["emotion"])
    ? (rawEmotion as AIResponse["emotion"])
    : "normal"
  const innerHeart = typeof payload.inner_heart === "string" ? payload.inner_heart.trim() : ""
  const narration = typeof payload.narration === "string" ? payload.narration.trim() : ""

  return {
    emotion,
    inner_heart: innerHeart,
    response,
    ...(narration ? { narration } : {}),
  }
}

export const parseStoredJsonContent = (content: unknown): unknown => {
  if (typeof content !== "string") {
    return content
  }

  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

export const toMessageContent = (content: unknown, role: "user" | "assistant"): Message["content"] => {
  const parsedContent = parseStoredJsonContent(content)

  if (role === "user") {
    if (typeof parsedContent === "string") {
      return parsedContent
    }

    if (parsedContent && typeof parsedContent === "object") {
      const objectValue = parsedContent as Record<string, unknown>
      if (typeof objectValue.text === "string" && objectValue.text.trim()) {
        return objectValue.text
      }
      if (typeof objectValue.response === "string" && objectValue.response.trim()) {
        return objectValue.response
      }
    }

    return ""
  }

  const assistantPayload = sanitizeAssistantPayload(parsedContent)
  if (assistantPayload) {
    return assistantPayload
  }

  if (typeof parsedContent === "string" && parsedContent.trim()) {
    return {
      emotion: "normal",
      inner_heart: "",
      response: parsedContent,
    }
  }

  return {
    emotion: "normal",
    inner_heart: "",
    response: "대화를 다시 이어가보자.",
  }
}

export const toPreviewText = (content: Message["content"]): string => {
  if (typeof content === "string") {
    return content
  }
  return typeof content.response === "string" ? content.response : ""
}

export const parseSavedContentToPreview = (content: unknown): string => {
  const parsed = parseStoredJsonContent(content)
  if (typeof parsed === "string") {
    return parsed
  }
  if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).response === "string") {
    return String((parsed as Record<string, unknown>).response)
  }
  if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).text === "string") {
    return String((parsed as Record<string, unknown>).text)
  }
  return ""
}

export const toTruncatedPreview = (text: string, max = 48): string => {
  const normalized = String(text || "").replace(/\s+/g, " ").trim()
  if (normalized.length <= max) {
    return normalized
  }
  return `${normalized.slice(0, max)}…`
}
