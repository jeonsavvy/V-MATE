import { useEffect, useRef } from "react"
import type { Message } from "@/lib/data"

interface UseChatViewportParams {
  messages: Message[]
  inputValue: string
}

export const useChatViewport = ({ messages, inputValue }: UseChatViewportParams) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)

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

  return {
    scrollRef,
    messageInputRef,
  }
}
