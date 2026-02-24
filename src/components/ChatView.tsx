import { useState, useRef, useEffect, useMemo } from "react"
import { Character, Message, AIResponse, CHARACTERS } from "@/lib/data"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { Send, ArrowLeft, Trash2, PanelRightOpen, PanelRightClose, Sparkles, Heart } from "lucide-react"
import { CHARACTER_UI_META } from "@/lib/character-ui"
import { User as SupabaseUser } from "@supabase/supabase-js"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"

interface ChatViewProps {
  character: Character
  onCharacterChange: (charId: string) => void
  user: SupabaseUser | null
  onBack: () => void
}

interface HistoryPreview {
  text: string
  updatedAt: string | null
  hasHistory: boolean
}

const toPreviewText = (content: Message["content"]): string => {
  if (typeof content === "string") {
    return content
  }
  return typeof content.response === "string" ? content.response : ""
}

const toTruncatedPreview = (text: string, max = 48): string => {
  const normalized = String(text || "").replace(/\s+/g, " ").trim()
  if (normalized.length <= max) {
    return normalized
  }
  return `${normalized.slice(0, max)}…`
}

const parseSavedContentToPreview = (content: unknown): string => {
  if (typeof content !== "string") {
    if (content && typeof content === "object" && typeof (content as AIResponse).response === "string") {
      return (content as AIResponse).response
    }
    return ""
  }

  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === "string") {
      return parsed
    }
    if (parsed && typeof parsed === "object" && typeof parsed.response === "string") {
      return parsed.response
    }
    return content
  } catch {
    return content
  }
}

const resolveChatApiUrl = (): string => {
  const baseUrl = String(import.meta.env.VITE_CHAT_API_BASE_URL || "").trim().replace(/\/+$/, "")
  if (!baseUrl) {
    return "/api/chat"
  }
  return baseUrl.endsWith("/api/chat") ? baseUrl : `${baseUrl}/api/chat`
}

type ChatApiError = Error & {
  chatErrorCode?: string
  chatTraceId?: string
}

const createChatApiError = (message: string, errorCode?: string, traceId?: string): ChatApiError => {
  const error = new Error(message) as ChatApiError
  if (errorCode) {
    error.chatErrorCode = errorCode
  }
  if (traceId) {
    error.chatTraceId = traceId
  }
  return error
}

const mapChatApiErrorMessage = (errorCode: string, fallbackMessage: string) => {
  switch (errorCode) {
    case "UPSTREAM_CONNECTION_FAILED":
    case "UPSTREAM_TIMEOUT":
    case "FUNCTION_BUDGET_TIMEOUT":
    case "UPSTREAM_EMPTY_RESPONSE":
    case "UPSTREAM_EMPTY_RESPONSE_MAX_TOKENS":
      return "AI 서버 연결이 불안정합니다. 잠시 후 다시 시도해주세요."
    case "UPSTREAM_LOCATION_UNSUPPORTED":
      return "현재 서버 지역에서는 Gemini API를 사용할 수 없습니다. 관리자에게 문의해주세요."
    case "UPSTREAM_INVALID_RESPONSE":
    case "UPSTREAM_INVALID_FORMAT":
      return "AI 응답 형식이 불안정합니다. 잠시 후 다시 시도해주세요."
    default:
      return fallbackMessage
  }
}

const NETWORK_ERROR_CODES = new Set([
  "CLIENT_NETWORK_ERROR",
  "CLIENT_TIMEOUT",
  "UPSTREAM_CONNECTION_FAILED",
  "UPSTREAM_TIMEOUT",
  "FUNCTION_BUDGET_TIMEOUT",
  "UPSTREAM_EMPTY_RESPONSE",
  "UPSTREAM_EMPTY_RESPONSE_MAX_TOKENS",
])

const CONFIGURATION_ERROR_CODES = new Set([
  "UPSTREAM_LOCATION_UNSUPPORTED",
  "UPSTREAM_INVALID_FORMAT",
  "UPSTREAM_INVALID_RESPONSE",
  "UPSTREAM_MODEL_ERROR",
])

const EMOTION_LABELS: Record<AIResponse["emotion"], string> = {
  normal: "기본 표정",
  happy: "기분 좋아짐",
  confused: "당황한 표정",
  angry: "감정 고조",
}

const QUICK_REPLY_TEMPLATES = ["계속 말해줘", "조금 더 자세히 알려줘", "다른 전개로 이어가줘"]

const systemPromptCache = new Map<string, string>()

const SYSTEM_PROMPT_LOADERS: Record<string, () => Promise<string>> = {
  mika: async () => (await import("@/lib/prompts/mika")).buildMikaPrompt(),
  alice: async () => (await import("@/lib/prompts/alice")).buildAlicePrompt(),
  kael: async () => (await import("@/lib/prompts/kael")).buildKaelPrompt(),
}

const resolveSystemPrompt = async (characterId: string): Promise<string> => {
  if (systemPromptCache.has(characterId)) {
    return systemPromptCache.get(characterId) || ""
  }

  const loader = SYSTEM_PROMPT_LOADERS[characterId]
  if (!loader) {
    return ""
  }

  const loadedPrompt = await loader()
  const normalizedPrompt = String(loadedPrompt || "").trim()
  if (normalizedPrompt) {
    systemPromptCache.set(characterId, normalizedPrompt)
  }
  return normalizedPrompt
}

export function ChatView({ character, onCharacterChange, user, onBack }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "greeting",
      role: "assistant",
      content: {
        emotion: "normal",
        inner_heart: "",
        response: character.greeting,
      },
    },
  ])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [historyPreviews, setHistoryPreviews] = useState<Record<string, HistoryPreview>>({})
  const [showEmotionIllustrations, setShowEmotionIllustrations] = useState(true)
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const isLoadingHistoryRef = useRef(false)
  const messagesRef = useRef(messages)
  const chatApiUrlRef = useRef(resolveChatApiUrl())
  const getPromptCacheKey = (charId: string) => `gemini_cached_content_${charId}`
  const resolveEmotionImage = (emotion?: AIResponse["emotion"]) => {
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

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    void resolveSystemPrompt(character.id)
  }, [character.id])

  useEffect(() => {
    setIsInfoPanelOpen(false)
  }, [character.id])

  useEffect(() => {
    const loadHistory = async () => {
      isLoadingHistoryRef.current = true

      try {
        if (!user) {
          const localKey = `chat_history_${character.id}`
          const saved = localStorage.getItem(localKey)
          if (saved) {
            try {
              const parsed = JSON.parse(saved)
              console.log(`Loaded ${parsed.length} messages from localStorage for character ${character.id}`)
              if (parsed.length === 0 || parsed[0].id !== "greeting") {
                setMessages([
                  {
                    id: "greeting",
                    role: "assistant",
                    content: {
                      emotion: "normal",
                      inner_heart: "",
                      response: character.greeting,
                    },
                  },
                  ...parsed,
                ])
              } else {
                const updatedMessages = [...parsed]
                updatedMessages[0] = {
                  id: "greeting",
                  role: "assistant",
                  content: {
                    emotion: "normal",
                    inner_heart: "",
                    response: character.greeting,
                  },
                }
                setMessages(updatedMessages)
              }
            } catch (e) {
              console.error("Failed to parse local history", e)
              setMessages([
                {
                  id: "greeting",
                  role: "assistant",
                  content: {
                    emotion: "normal",
                    inner_heart: "",
                    response: character.greeting,
                  },
                },
              ])
            }
          } else {
            console.log(`No saved messages found in localStorage for character ${character.id}`)
            setMessages([
              {
                id: "greeting",
                role: "assistant",
                content: {
                  emotion: "normal",
                  inner_heart: "",
                  response: character.greeting,
                },
              },
            ])
          }
        } else {
          if (!isSupabaseConfigured()) {
            console.warn("Supabase is not configured, cannot load chat history for logged in user")
            setMessages([
              {
                id: "greeting",
                role: "assistant",
                content: {
                  emotion: "normal",
                  inner_heart: "",
                  response: character.greeting,
                },
              },
            ])
            return
          }

          const { data: { session } } = await supabase.auth.getSession()
          if (!session) {
            console.warn("No session found, cannot load chat history for logged in user")
            setMessages([
              {
                id: "greeting",
                role: "assistant",
                content: {
                  emotion: "normal",
                  inner_heart: "",
                  response: character.greeting,
                },
              },
            ])
            return
          }

          console.log(`Loading chat history for user ${user.id}, character ${character.id}`)
          const { data, error } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('user_id', user.id)
            .eq('character_id', character.id)
            .order('created_at', { ascending: true })

          if (error) {
            console.error("Supabase query error:", error)
            throw error
          }

          console.log(`Loaded ${data?.length || 0} messages from Supabase for user ${user.id}, character ${character.id}`)
          if (data && data.length > 0) {
            console.log("Raw data from Supabase:", data)
          }

          if (data && data.length > 0) {
            const loadedMessages: Message[] = data.map((msg: any) => {
              try {
                const content = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content
                return {
                  id: msg.id,
                  role: msg.role as "user" | "assistant",
                  content: content,
                  timestamp: msg.created_at,
                }
              } catch (e) {
                console.error("Failed to parse message content:", msg, e)
                return {
                  id: msg.id,
                  role: msg.role as "user" | "assistant",
                  content: typeof msg.content === 'string' ? msg.content : msg.content,
                  timestamp: msg.created_at,
                }
              }
            })

            console.log(`Parsed ${loadedMessages.length} messages`)

            if (loadedMessages.length === 0 || loadedMessages[0].id !== "greeting") {
              setMessages([
                {
                  id: "greeting",
                  role: "assistant",
                  content: {
                    emotion: "normal",
                    inner_heart: "",
                    response: character.greeting,
                  },
                },
                ...loadedMessages,
              ])
            } else {
              const updatedMessages = [...loadedMessages]
              if (updatedMessages[0]?.id === "greeting") {
                updatedMessages[0] = {
                  id: "greeting",
                  role: "assistant",
                  content: {
                    emotion: "normal",
                    inner_heart: "",
                    response: character.greeting,
                  },
                }
              }
              setMessages(updatedMessages)
            }
          } else {
            console.log("No messages found in Supabase, showing greeting only")
            setMessages([
              {
                id: "greeting",
                role: "assistant",
                content: {
                  emotion: "normal",
                  inner_heart: "",
                  response: character.greeting,
                },
              },
            ])
          }
        }
      } catch (error) {
        console.error("Failed to load chat history", error)
        setMessages([
          {
            id: "greeting",
            role: "assistant",
            content: {
              emotion: "normal",
              inner_heart: "",
              response: character.greeting,
            },
          },
        ])
      } finally {
        isLoadingHistoryRef.current = false
      }
    }

    loadHistory()
  }, [user, character.id])

  useEffect(() => {
    const loadHistoryPreviews = async () => {
      const initialPreviews: Record<string, HistoryPreview> = {}

      if (!user) {
        Object.values(CHARACTERS).forEach((char) => {
          const localKey = `chat_history_${char.id}`
          const saved = localStorage.getItem(localKey)
          if (!saved) return

          try {
            const parsed = JSON.parse(saved) as Message[]
            const last = parsed[parsed.length - 1]
            if (!last) return

            initialPreviews[char.id] = {
              text: toTruncatedPreview(toPreviewText(last.content)),
              updatedAt: last.timestamp || null,
              hasHistory: true,
            }
          } catch (error) {
            console.error(`Failed to parse preview history for ${char.id}`, error)
          }
        })

        setHistoryPreviews(initialPreviews)
        return
      }

      if (!isSupabaseConfigured()) {
        setHistoryPreviews(initialPreviews)
        return
      }

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          setHistoryPreviews(initialPreviews)
          return
        }

        const { data, error } = await supabase
          .from('chat_messages')
          .select('character_id, content, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })

        if (error) {
          throw error
        }

        data?.forEach((row: any) => {
          const targetCharacterId = String(row.character_id || '')
          if (!CHARACTERS[targetCharacterId]) return

          const preview = toTruncatedPreview(parseSavedContentToPreview(row.content))
          if (!preview) return

          initialPreviews[targetCharacterId] = {
            text: preview,
            updatedAt: row.created_at || null,
            hasHistory: true,
          }
        })

        setHistoryPreviews(initialPreviews)
      } catch (error) {
        console.error("Failed to load history previews", error)
        setHistoryPreviews(initialPreviews)
      }
    }

    loadHistoryPreviews()
  }, [user])

  useEffect(() => {
    if (isLoadingHistoryRef.current) {
      console.log("Skipping save: history is loading")
      return
    }

    if (!user && messages.length > 1) {
      const localKey = `chat_history_${character.id}`
      const messagesToSave = messages.filter(msg => msg.id !== "greeting")
      if (messagesToSave.length > 0) {
        try {
          localStorage.setItem(localKey, JSON.stringify(messagesToSave))
          console.log(`Saved ${messagesToSave.length} messages to localStorage for character ${character.id}`)
        } catch (e) {
          console.error("Failed to save to localStorage", e)
        }
      }
    }
  }, [messages, user, character.id])

  useEffect(() => {
    if (user) return // 로그인 사용자는 제외

    const handleBeforeUnload = () => {
      if (messagesRef.current.length > 1) {
        const localKey = `chat_history_${character.id}`
        const messagesToSave = messagesRef.current.filter(msg => msg.id !== "greeting")
        if (messagesToSave.length > 0) {
          try {
            localStorage.setItem(localKey, JSON.stringify(messagesToSave))
          } catch (e) {
            console.error("Failed to save to localStorage on unload", e)
          }
        }
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      handleBeforeUnload()
    }
  }, [user, character.id])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (!messageInputRef.current) {
      return
    }

    messageInputRef.current.style.height = "0px"
    messageInputRef.current.style.height = `${Math.min(messageInputRef.current.scrollHeight, 156)}px`
  }, [inputValue])

  useEffect(() => {
    if (messages.length <= 1) {
      setHistoryPreviews((prev) => {
        if (!prev[character.id]) {
          return prev
        }

        const next = { ...prev }
        delete next[character.id]
        return next
      })
      return
    }

    const latestMessage = messages[messages.length - 1]
    const latestText = toTruncatedPreview(toPreviewText(latestMessage.content))
    if (!latestText) {
      return
    }

    setHistoryPreviews((prev) => ({
      ...prev,
      [character.id]: {
        text: latestText,
        updatedAt: new Date().toISOString(),
        hasHistory: true,
      },
    }))
  }, [messages, character.id])

  const handleSendMessage = async () => {
    const text = inputValue.trim()
    if (!text || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    }
    setMessages((prev) => [...prev, userMessage])

    if (user) {
      void saveMessage(userMessage)
    }

    setInputValue("")
    setIsLoading(true)

    try {
      const messageHistory = messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : msg.content.response,
      }))
      const systemPrompt = await resolveSystemPrompt(character.id)
      if (!systemPrompt) {
        throw createChatApiError("캐릭터 시스템 설정을 불러오지 못했습니다. 다시 시도해주세요.", "CLIENT_PROMPT_LOAD_FAILED")
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 17000)

      let response
      const cacheStorageKey = getPromptCacheKey(character.id)
      const cachedContent = localStorage.getItem(cacheStorageKey)
      try {
        response = await fetch(chatApiUrlRef.current, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            characterId: character.id,
            systemPrompt,
            userMessage: text,
            messageHistory: messageHistory.slice(1), // greeting 제외
            cachedContent: cachedContent || undefined,
          }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        if (fetchError.name === "AbortError") {
          throw createChatApiError("응답 시간이 초과되었습니다. 네트워크 연결을 확인해주세요.", "CLIENT_TIMEOUT")
        } else if (fetchError.message.includes("Failed to fetch")) {
          throw createChatApiError("서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.", "CLIENT_NETWORK_ERROR")
        }
        throw fetchError
      }

      if (!response.ok) {
        let errorMessage = "서버 오류가 발생했습니다."
        let errorCode = ""
        let traceId = String(response.headers.get("x-v-mate-trace-id") || "").trim()
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorMessage
          errorCode = errorData.error_code || ""
          if (typeof errorData.trace_id === "string" && errorData.trace_id.trim()) {
            traceId = errorData.trace_id.trim()
          }
          if (errorMessage.includes("API key") || errorMessage.includes("GOOGLE_API_KEY")) {
            errorMessage = "API 키가 설정되지 않았거나 만료되었습니다. 관리자에게 문의해주세요."
          } else if (
            errorCode === "UPSTREAM_LOCATION_UNSUPPORTED" ||
            errorMessage.includes("location is not supported")
          ) {
            errorMessage = "현재 서버 지역에서는 Gemini API를 사용할 수 없습니다. 관리자에게 문의해주세요."
          } else if (
            errorCode === "UPSTREAM_CONNECTION_FAILED" ||
            errorCode === "UPSTREAM_TIMEOUT" ||
            errorCode === "FUNCTION_BUDGET_TIMEOUT" ||
            errorMessage.includes("Failed to connect to Gemini API") ||
            errorMessage.includes("temporarily unavailable") ||
            errorMessage.includes("overloaded")
          ) {
            errorMessage = "현재 AI 서버 연결이 불안정합니다. 잠시 후 다시 시도해주세요."
          }
        } catch (e) {
          if (response.status === 500) {
            errorMessage = "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
          } else if (response.status === 503) {
            errorMessage = "서비스가 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해주세요."
          }
        }
        errorMessage = mapChatApiErrorMessage(errorCode, errorMessage)
        throw createChatApiError(errorMessage, errorCode || `HTTP_${response.status}`, traceId)
      }

      const data = await response.json()
      const traceId = (
        typeof data.trace_id === "string" && data.trace_id.trim()
          ? data.trace_id
          : String(response.headers.get("x-v-mate-trace-id") || "").trim()
      )
      if (data.error) {
        const errorCode = typeof data.error_code === "string" ? data.error_code : ""
        throw createChatApiError(
          mapChatApiErrorMessage(errorCode, data.error),
          errorCode || "UPSTREAM_RESPONSE_ERROR",
          traceId,
        )
      }
      if (typeof data.error_code === "string" && data.error_code.trim()) {
        throw createChatApiError(
          mapChatApiErrorMessage(data.error_code, "AI 서버 처리 중 오류가 발생했습니다."),
          data.error_code,
          traceId,
        )
      }
      if (Object.prototype.hasOwnProperty.call(data, "cachedContent")) {
        if (typeof data.cachedContent === "string" && data.cachedContent.trim()) {
          localStorage.setItem(cacheStorageKey, data.cachedContent.trim())
        } else if (data.cachedContent === null) {
          localStorage.removeItem(cacheStorageKey)
        }
      }
      if (!data.text) {
        throw createChatApiError("서버로부터 응답을 받지 못했습니다. 다시 시도해주세요.", "UPSTREAM_EMPTY_BODY", traceId)
      }

      const rawText = data.text
      const jsonStr = rawText.replace(/```json/g, "").replace(/```/g, "").trim()

      let parsed: AIResponse
      try {
        parsed = JSON.parse(jsonStr)
        if (!parsed.emotion || !parsed.response) {
          throw new Error("응답 형식이 올바르지 않습니다.")
        }
        if (typeof parsed.narration === "string") {
          parsed.narration = parsed.narration.trim()
        }
      } catch (parseError) {
        throw createChatApiError(
          "AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해주세요.",
          "UPSTREAM_INVALID_FORMAT",
          traceId,
        )
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: parsed,
      }
      setMessages((prev) => [...prev, assistantMessage])

      if (user) {
        void saveMessage(assistantMessage)
      }
    } catch (err: any) {
      let parsed: AIResponse
      const errorCode = typeof err?.chatErrorCode === "string" ? err.chatErrorCode : ""
      const traceId = typeof err?.chatTraceId === "string" ? err.chatTraceId : ""
      const errorMsg = err.message || "알 수 없는 오류가 발생했습니다."
      const traceSuffix = traceId ? ` (trace: ${traceId})` : ""

      if (errorCode) {
        console.error("[V-MATE] Chat request failed", {
          characterId: character.id,
          errorCode,
          traceId: traceId || null,
          message: errorMsg,
        })
      }

      if (NETWORK_ERROR_CODES.has(errorCode) || errorMsg.includes("네트워크") || errorMsg.includes("연결")) {
        parsed = {
          emotion: "normal",
          inner_heart:
            character.id === "mika"
              ? "서버 연결이 흔들려서 답장을 못 만들었어..."
              : character.id === "alice"
                ? "상류 모델 연결이 불안정하군."
                : "서버 연결 불안정.",
          response:
            character.id === "mika"
              ? `선생님, 지금 AI 서버 연결이 불안정해서 답장을 만들지 못했어. 잠깐 뒤에 다시 시도해줘.${traceSuffix}`
              : character.id === "alice"
                ? `현재 AI 서버 연결이 불안정하여 응답 생성에 실패했다. 잠시 후 다시 시도해달라.${traceSuffix}`
                : `지금 AI 서버 연결이 불안정해서 답장 생성 실패. 잠깐 뒤에 다시 시도해줘.${traceSuffix}`,
        }
      } else if (errorCode === "UPSTREAM_LOCATION_UNSUPPORTED" || errorMsg.includes("서버 지역") || errorMsg.includes("location is not supported")) {
        parsed = {
          emotion: "normal",
          inner_heart:
            character.id === "mika"
              ? "서버 지역 정책 때문에 호출이 막혔어..."
              : character.id === "alice"
                ? "현재 배포 지역 정책으로 호출이 제한되는군."
                : "서버 지역 정책으로 차단됨.",
          response:
            character.id === "mika"
              ? `선생님, 지금 서버 지역에서는 AI 호출이 제한돼. 관리자에게 배포 지역 변경이나 모델 전환을 요청해줘.${traceSuffix}`
              : character.id === "alice"
                ? `현재 서버 지역에서는 Gemini API 호출이 제한된다. 관리자에게 배포 지역 변경 또는 모델 전환을 요청해달라.${traceSuffix}`
                : `지금 서버 지역에서 Gemini 호출 제한됨. 관리자에게 지역/모델 변경 요청해줘.${traceSuffix}`,
        }
      } else if (
        errorCode === "UPSTREAM_INVALID_FORMAT" ||
        errorCode === "UPSTREAM_INVALID_RESPONSE" ||
        errorMsg.includes("응답 형식")
      ) {
        parsed = {
          emotion: "normal",
          inner_heart:
            character.id === "mika"
              ? "응답 포맷이 깨져서 지금은 안전하게 멈추는 게 맞아..."
              : character.id === "alice"
                ? "응답 계약(JSON) 파싱에 실패했다."
                : "응답 포맷 깨짐.",
          response:
            character.id === "mika"
              ? `선생님, 방금 AI 응답 형식이 깨져서 처리에 실패했어. 한 번만 다시 시도해줘.${traceSuffix}`
              : character.id === "alice"
                ? `AI 응답 형식 오류로 처리에 실패했다. 잠시 후 다시 시도해달라.${traceSuffix}`
                : `AI 응답 형식 오류로 처리 실패. 잠깐 뒤에 다시 시도해줘.${traceSuffix}`,
        }
      } else if (errorMsg.includes("API 키") || errorMsg.includes("만료")) {
        parsed = {
          emotion: "normal",
          inner_heart: "서버 쪽에 문제가 있는 것 같다...",
          response:
            character.id === "mika"
              ? `선생님, 서버 API 키 설정에 문제가 있어 보여. 관리자에게 확인 요청해줘.${traceSuffix}`
              : character.id === "alice"
                ? `API 키 설정 오류로 요청이 거절되었다. 관리자에게 확인을 요청해달라.${traceSuffix}`
                : `서버 API 키 설정 문제로 요청 실패. 관리자 확인 필요.${traceSuffix}`,
        }
      } else if (errorMsg.includes("시간이 초과")) {
        parsed = {
          emotion: "normal",
          inner_heart: "시간이 오래 걸리는구나...",
          response:
            character.id === "mika"
              ? `선생님, 응답 시간이 초과됐어. 잠깐 뒤에 다시 시도해줘.${traceSuffix}`
              : character.id === "alice"
                ? `응답 지연으로 요청이 종료되었다. 잠시 후 다시 시도해달라.${traceSuffix}`
                : `응답 시간 초과로 요청 종료. 잠깐 뒤 다시 시도해줘.${traceSuffix}`,
        }
      } else if (CONFIGURATION_ERROR_CODES.has(errorCode)) {
        parsed = {
          emotion: "normal",
          inner_heart: "서버 설정 이슈가 있는 것 같다.",
          response:
            character.id === "mika"
              ? `선생님, 서버 설정 문제로 답장을 만들지 못했어. 관리자 확인이 필요해.${traceSuffix}`
              : character.id === "alice"
                ? `서버 설정 문제로 요청에 실패했다. 관리자 확인이 필요하다.${traceSuffix}`
                : `서버 설정 문제로 요청 실패. 관리자 확인 필요.${traceSuffix}`,
        }
      } else {
        parsed = {
          emotion: "normal",
          inner_heart:
            character.id === "mika"
              ? "뭔가 이상한데... 선생님한테는 보여주고 싶지 않은데..."
              : character.id === "alice"
                ? "오류가 발생했다. 다시 시도해보자."
                : "어? 뭔가 이상한데...",
          response:
            character.id === "mika"
              ? `선생님, 예상치 못한 오류가 발생했어. 잠시 후 다시 시도해줘.${traceSuffix}`
              : character.id === "alice"
                ? `예상치 못한 오류가 발생했다. 잠시 후 다시 시도해달라.${traceSuffix}`
                : `예상치 못한 오류 발생. 잠시 후 다시 시도해줘.${traceSuffix}`,
        }
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: parsed,
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const saveMessage = async (msg: Message) => {
    if (!user || !isSupabaseConfigured()) {
      console.log("Cannot save message: no user or supabase not configured")
      return
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        console.log("Cannot save message: no session")
        return
      }

      const contentToSave = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          user_id: user.id,
          character_id: character.id,
          role: msg.role,
          content: contentToSave,
        })
        .select()

      if (error) {
        console.error("Failed to save message to Supabase:", error)
        throw error
      }

      console.log("Message saved successfully:", data?.[0]?.id)
    } catch (error) {
      console.error("Failed to save message", error)
    }
  }

  const handleClearChat = async () => {
    if (!confirm("정말로 대화를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
      return
    }

    if (user) {
      if (isSupabaseConfigured()) {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (session) {
            const { error } = await supabase
              .from('chat_messages')
              .delete()
              .eq('user_id', user.id)
              .eq('character_id', character.id)

            if (error) throw error
          }
        } catch (error) {
          console.error("Failed to clear chat", error)
          alert("대화 초기화에 실패했습니다. 다시 시도해주세요.")
          return
        }
      }
    } else {
      const localKey = `chat_history_${character.id}`
      localStorage.removeItem(localKey)
    }

    setMessages([
      {
        id: "greeting",
        role: "assistant",
        content: {
          emotion: "normal",
          inner_heart: "",
          response: character.greeting,
        },
      },
    ])
    setHistoryPreviews((prev) => {
      if (!prev[character.id]) {
        return prev
      }

      const next = { ...prev }
      delete next[character.id]
      return next
    })
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return
    }

    event.preventDefault()
    void handleSendMessage()
  }

  const handleQuickReplyClick = (template: string) => {
    setInputValue(template)
    requestAnimationFrame(() => {
      messageInputRef.current?.focus()
    })
  }

  const characterMeta = CHARACTER_UI_META[character.id]
  const sidebarCharacterEntries = Object.values(CHARACTERS)
    .map((item) => {
      const preview = historyPreviews[item.id]
      const fallback = toTruncatedPreview(CHARACTER_UI_META[item.id]?.summary || "", 52)

      return {
        character: item,
        hasHistory: Boolean(preview?.hasHistory),
        updatedAt: preview?.updatedAt || null,
        previewText: preview?.text || fallback,
      }
    })
    .sort((a, b) => {
      if (a.character.id === character.id) return -1
      if (b.character.id === character.id) return 1
      if (a.hasHistory !== b.hasHistory) return a.hasHistory ? -1 : 1

      const dateA = a.updatedAt ? Date.parse(a.updatedAt) || 0 : 0
      const dateB = b.updatedAt ? Date.parse(b.updatedAt) || 0 : 0
      return dateB - dateA
    })
  const preparedMessages = useMemo(() => {
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
      const messageImage = resolveEmotionImage(emotion)

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
  }, [messages, showEmotionIllustrations, character])

  const latestAssistantMessage = [...messages]
    .reverse()
    .find((msg) => msg.role === "assistant" && typeof msg.content !== "string") as Message | undefined
  const latestAssistantPayload = latestAssistantMessage && typeof latestAssistantMessage.content !== "string"
    ? latestAssistantMessage.content
    : null
  const activeEmotion = latestAssistantPayload?.emotion || "normal"
  const activeEmotionLabel = EMOTION_LABELS[activeEmotion]

  return (
    <div className="relative h-dvh overflow-hidden bg-[#e7dfd3] text-[#22242b]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(123,109,140,0.14),transparent_36%),radial-gradient(circle_at_84%_85%,rgba(112,139,160,0.1),transparent_34%)]" />

      <div
        className={cn(
          "relative z-10 mx-auto grid h-full w-full max-w-[1680px] lg:grid-cols-[300px_minmax(0,1fr)]",
          isInfoPanelOpen && "xl:grid-cols-[300px_minmax(0,1fr)_320px]"
        )}
      >
        <aside className="hidden h-full border-r border-white/45 bg-[#eee7db]/72 p-4 backdrop-blur-xl lg:block">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-2">
              <p className="text-sm font-bold text-[#2f3138]">캐릭터 목록</p>
              <p className="text-xs text-[#8e867a]">{sidebarCharacterEntries.filter((entry) => entry.hasHistory).length}개 기록</p>
            </div>

            <div className="mt-4 space-y-2 overflow-y-auto pr-1">
              {sidebarCharacterEntries.map((entry) => {
                const item = entry.character
                const isActive = item.id === character.id

                return (
                  <button
                    key={item.id}
                    onClick={() => onCharacterChange(item.id)}
                    className={cn(
                      "w-full rounded-2xl border p-3 text-left shadow-[0_14px_24px_-20px_rgba(23,22,20,0.72)] transition",
                      isActive
                        ? "border-[#d4c2ed] bg-white/94"
                        : "border-white/45 bg-white/74 hover:border-[#d1bfe9]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar
                        src={item.images.normal}
                        alt={item.name}
                        fallback={item.name[0]}
                        className="size-10 border border-black/10 object-cover object-top"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="truncate text-sm font-bold text-[#2f3138]">{item.name}</p>
                          <span className="rounded-full border border-[#d8cebf] bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-[#7b7469]">
                            {entry.hasHistory ? "최근" : "새 대화"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-[#6b655b]">{entry.previewText}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        <div className="flex h-full min-w-0 flex-col">
          <header className="flex items-center justify-between border-b border-white/55 bg-[#efe8dc]/90 p-3 shadow-[0_16px_26px_-24px_rgba(23,22,19,0.8)] backdrop-blur-xl lg:px-6 lg:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                onClick={onBack}
                className="h-10 rounded-xl text-[#666259] hover:bg-black/5 hover:text-[#2f3138]"
              >
                <ArrowLeft className="mr-1.5 h-5 w-5" />
                <span className="hidden sm:inline">홈으로</span>
              </Button>

              <div className="min-w-0">
                <p className="truncate text-base font-bold text-[#2f3138]">{character.name}</p>
                <p className="truncate text-xs text-[#6e675c]">{characterMeta.tags.join(" · ")}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsInfoPanelOpen((prev) => !prev)}
                className="h-9 rounded-xl px-3 text-xs font-semibold text-[#5c5769] hover:bg-[#7d6aa8]/10"
                aria-expanded={isInfoPanelOpen}
                aria-label="캐릭터 정보 패널 열기"
              >
                {isInfoPanelOpen ? <PanelRightClose className="mr-1 h-4 w-4" /> : <PanelRightOpen className="mr-1 h-4 w-4" />}
                정보
              </Button>
              <Button
                variant="ghost"
                onClick={handleClearChat}
                className="h-9 rounded-xl text-[#7a756d] hover:bg-red-500/10 hover:text-red-500"
                title="대화 초기화"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <select
                value={character.id}
                onChange={(e) => onCharacterChange(e.target.value)}
                className="cursor-pointer rounded-xl border border-[#c7bcac] bg-white/80 px-2.5 py-1.5 text-xs text-[#5f635f] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] outline-none transition hover:bg-white focus:border-[#8b6cc7] lg:hidden"
              >
                {Object.values(CHARACTERS).map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </div>
          </header>

          {isInfoPanelOpen && (
            <section className="border-b border-white/45 bg-[#f2ebdf]/92 px-3 py-3 xl:hidden">
              <div className="mx-auto w-full max-w-[980px] space-y-3 rounded-2xl border border-white/45 bg-white/72 p-3">
                <div className="flex items-center gap-3">
                  <img src={character.images.normal} alt={character.name} className="h-16 w-16 rounded-xl object-cover object-top" />
                  <div>
                    <p className="text-sm font-bold text-[#2f3138]">{character.name}</p>
                    <p className="text-xs text-[#6d665b]">{characterMeta.tags.join(" · ")}</p>
                    <p className="mt-1 text-xs font-semibold text-[#7a638f]">{activeEmotionLabel}</p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-[#4f493f]">{characterMeta.summary}</p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowEmotionIllustrations((prev) => !prev)}
                  className={cn(
                    "h-9 w-full rounded-xl text-xs font-semibold",
                    showEmotionIllustrations ? "text-[#5b5668] hover:bg-[#7d6aa8]/10" : "text-[#7a756d] hover:bg-black/5"
                  )}
                >
                  {showEmotionIllustrations ? "감정 일러스트 ON" : "감정 일러스트 OFF"}
                </Button>
              </div>
            </section>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 scroll-smooth sm:px-4 lg:px-8 lg:py-6">
            <div className="mx-auto w-full max-w-[980px] space-y-5">
              <p className="mx-auto w-fit rounded-full border border-white/45 bg-white/58 px-3 py-1 text-center text-xs font-semibold text-[#70695f]">
                이 대화는 AI로 생성된 가상의 이야기입니다
              </p>

              {preparedMessages.map(({ msg, isUser, content, innerHeart, narration, emotion, showIllustrationCard, messageImage }) => (
                <div key={msg.id} className={cn("fade-in flex w-full", isUser ? "justify-end" : "justify-start")}>
                  <div className={cn("flex w-full gap-3", isUser ? "max-w-[84%] flex-row-reverse sm:max-w-[76%]" : "max-w-[92%] sm:max-w-[84%]")}>
                    {!isUser && (
                      <Avatar
                        src={messageImage}
                        alt={character.name}
                        fallback={character.name[0]}
                        className="mt-1 size-9 shrink-0 border border-black/10 object-cover object-top"
                      />
                    )}

                    <div className="min-w-0 flex-1 space-y-2">
                      <p className={cn("px-1 text-[11px] font-semibold", isUser ? "text-right text-[#70688a]" : "text-[#6b6474]")}>
                        {isUser ? "나" : `${character.name}${emotion ? ` · ${EMOTION_LABELS[emotion]}` : ""}`}
                      </p>

                      {showIllustrationCard && emotion && (
                        <div className="w-full max-w-[760px] overflow-hidden rounded-2xl border border-white/65 bg-white/92 shadow-[0_20px_34px_-24px_rgba(24,23,20,0.72)]">
                          <img
                            src={messageImage}
                            alt={`${character.name} ${emotion}`}
                            className="h-[260px] w-full object-cover object-top sm:h-[360px] lg:h-[440px]"
                            loading="lazy"
                            decoding="async"
                          />
                          <div className="border-t border-black/5 bg-[#f6f1e9] px-3 py-2 text-[11px] font-semibold text-[#5f584d]">
                            {character.name} · {EMOTION_LABELS[emotion]}
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
                </div>
              ))}

              {isLoading && (
                <div className="fade-in flex justify-start">
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

          <div className="border-t border-white/45 bg-[#ece4d8]/84 px-3 pb-[calc(0.95rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:px-4 lg:px-8 lg:pb-[calc(1.1rem+env(safe-area-inset-bottom))] lg:pt-4">
            <div className="mx-auto w-full max-w-[980px]">
              <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-white/45 bg-white/70 px-3 py-2">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5e5862]">
                  <Sparkles className="h-3.5 w-3.5 text-[#7b5cb8]" />
                  {isLoading ? `${character.name}이(가) 답변을 작성하고 있어요` : `${character.name}과 이어서 대화해보세요`}
                </div>
                <span className="rounded-full bg-[#f2ecff] px-2 py-1 text-[11px] font-semibold text-[#6a5991]">{activeEmotionLabel}</span>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {QUICK_REPLY_TEMPLATES.map((template) => (
                  <button
                    key={template}
                    type="button"
                    onClick={() => handleQuickReplyClick(template)}
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
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={isLoading ? "답변 생성 중입니다..." : "메시지를 입력하세요"}
                  disabled={isLoading}
                  rows={1}
                  className="max-h-[156px] min-h-[44px] flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 text-[#2a2c34] placeholder:text-[#847c73] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={isLoading || !inputValue.trim()}
                  className="h-11 shrink-0 rounded-xl bg-gradient-to-br from-[#4d3f74] to-[#3b3258] px-3 text-white shadow-[0_12px_22px_-14px_rgba(24,25,31,0.9)] hover:brightness-110 disabled:opacity-60"
                >
                  <Send className="mr-1 h-4 w-4" />
                  <span className="text-xs font-semibold">전송</span>
                </Button>
              </div>
              <p className="mt-2 px-1 text-[11px] text-[#8f877b]">Enter 전송 · Shift + Enter 줄바꿈</p>
            </div>
          </div>
        </div>

        {isInfoPanelOpen && (
          <aside className="hidden h-full border-l border-white/45 bg-[#f0e9dd]/82 p-4 backdrop-blur-xl xl:block">
            <div className="flex h-full flex-col gap-4">
              <div className="overflow-hidden rounded-2xl border border-white/45 bg-white/76 shadow-[0_18px_32px_-24px_rgba(20,18,15,0.74)]">
                <img
                  src={character.images.normal}
                  alt={character.name}
                  className="h-56 w-full object-cover object-top"
                />
                <div className="space-y-2 p-4">
                  <p className="text-lg font-bold text-[#2f3138]">{character.name}</p>
                  <p className="text-sm leading-relaxed text-[#4f493f]">{characterMeta.summary}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {characterMeta.tags.map((tag) => (
                      <span key={tag} className="rounded-md border border-[#dacfbf] bg-white/80 px-2 py-1 text-[11px] font-medium text-[#6b6459]">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {characterMeta.heroQuote && (
                    <p className="rounded-xl border border-[#e1d6ea] bg-[#f7effc] px-3 py-2 text-xs font-semibold leading-relaxed text-[#6b4d88]">
                      “{characterMeta.heroQuote}”
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/45 bg-white/72 p-4">
                <p className="text-sm font-bold text-[#2f3138]">대화 상태</p>
                <div className="rounded-xl border border-[#ddd1bf] bg-[#f7f1e6] px-3 py-2 text-xs text-[#5c564a]">
                  현재 감정: <span className="font-semibold text-[#6a5991]">{activeEmotionLabel}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowEmotionIllustrations((prev) => !prev)}
                  className={cn(
                    "h-10 w-full rounded-xl text-xs font-semibold",
                    showEmotionIllustrations ? "text-[#5b5668] hover:bg-[#7d6aa8]/10" : "text-[#7a756d] hover:bg-black/5"
                  )}
                  title={showEmotionIllustrations ? "감정 일러스트 숨기기" : "감정 일러스트 보기"}
                >
                  {showEmotionIllustrations ? "감정 일러스트 ON" : "감정 일러스트 OFF"}
                </Button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
