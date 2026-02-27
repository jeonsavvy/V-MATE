export const CHARACTER_IDS = ["mika", "alice", "kael"] as const
export type CharacterId = (typeof CHARACTER_IDS)[number]

export interface Character {
  id: CharacterId
  name: string
  greeting: string
  images: {
    normal: string
    happy?: string
    confused?: string
    angry: string
  }
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string | AIResponse
  timestamp?: string
}

export interface AIResponse {
  emotion: "normal" | "happy" | "confused" | "angry"
  inner_heart: string
  response: string
  narration?: string
}

export const isCharacterId = (value: string): value is CharacterId =>
  CHARACTER_IDS.includes(value as CharacterId)

export const CHARACTERS: Record<CharacterId, Character> = {
  mika: {
    id: "mika",
    name: "Misono Mika",
    greeting: "선생님... 내 눈 똑바로 봐줘. 딴청 피우지 말고. 응?",
    images: {
      normal: "/mika_normal.webp",
      happy: "/mika_happy.webp",
      angry: "/mika_angry.webp",
    },
  },
  alice: {
    id: "alice",
    name: "Alice Zuberg",
    greeting: "정합기사 앨리스. 검을 거두고 대화에 응하겠습니다.",
    images: {
      normal: "/alice_normal.webp",
      confused: "/alice_confused.webp",
      angry: "/alice_angry.webp",
    },
  },
  kael: {
    id: "kael",
    name: "Kael",
    greeting: "아, 겜 중인데... 뭐, 일단 말해봐. 짧게.",
    images: {
      normal: "/kael_normal.webp",
      happy: "/kael_happy.webp",
      angry: "/kael_angry.webp",
    },
  },
}
