import type { Character, Message } from "@/lib/data"

export const createGreetingMessage = (character: Character): Message => ({
  id: "greeting",
  role: "assistant",
  content: {
    emotion: "normal",
    inner_heart: "",
    response: character.greeting,
  },
})
