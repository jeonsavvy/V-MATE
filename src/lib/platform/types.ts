export type EntityType = 'character' | 'world'
export type Visibility = 'private' | 'unlisted' | 'public'
export type DisplayStatus = 'visible' | 'hidden' | 'draft'

export interface CreatorSummary {
  id: string
  slug: string
  name: string
  bio?: string
}

export interface EntitySummary {
  id: string
  entityType: EntityType
  slug: string
  name: string
  headline?: string
  summary: string
  coverImageUrl: string
  avatarImageUrl?: string
  tags: string[]
  creator: CreatorSummary
  visibility: Visibility
  displayStatus: DisplayStatus
  sourceType: string
  favoriteCount: number
  chatStartCount: number
  updatedAt: string
}

export interface CharacterSummary extends EntitySummary {
  entityType: 'character'
  avatarImageUrl: string
  imageSlots?: CharacterImageSlot[]
}

export interface WorldSummary extends EntitySummary {
  entityType: 'world'
  imageSlots?: CharacterImageSlot[]
}

export interface CharacterWorldLinkSummary {
  id: string
  characterSlug: string
  worldSlug: string
  world: WorldSummary
  linkReason: string
  defaultOpeningContext?: string
  defaultRelationshipContext?: string
}

export interface CharacterImageSlot {
  id: string
  slot: string
  usage: string
  trigger: string
  priority: number
  thumbUrl?: string
  cardUrl?: string
  detailUrl?: string
}

export interface HomeFeedPayload {
  home: {
    defaultTab: 'characters'
    filterChips: ['신작', '인기']
    hero: {
      title: string
      subtitle: string
      coverImageUrl: string
      targetPath: string
    }
    characterFeed: {
      items: CharacterSummary[]
    }
    worldFeed: {
      items: WorldSummary[]
    }
  }
}

export interface CharacterDetail extends CharacterSummary {
  profileSections: Array<{ title: string; body: string }>
  gallery: string[]
  worlds: CharacterWorldLinkSummary[]
  imageSlots: CharacterImageSlot[]
  profileJson?: Record<string, unknown>
  speechStyleJson?: Record<string, unknown>
  promptProfileJson?: Record<string, unknown>
}

export interface WorldDetail extends WorldSummary {
  worldSections: Array<{ title: string; body: string }>
  gallery: string[]
  characters: CharacterSummary[]
  promptProfileJson?: Record<string, unknown>
}

export interface BridgeProfile {
  entryMode: 'direct_character' | 'in_world'
  characterRoleInWorld: string
  userRoleInWorld: string
  meetingTrigger: string
  relationshipDistance: string
  currentGoal: string
  startingLocation: string
  worldTerms: string[]
  firstScenePressure: string
}

export interface RoomStateSummary {
  currentSituation: string
  location: string
  relationshipState: string
  inventory: string[]
  appearance: string[]
  pose: string[]
  futurePromises: string[]
  worldNotes: string[]
}

export interface RoomMessage {
  id: string
  role: 'user' | 'assistant'
  createdAt: string
  content: string | {
    emotion: 'normal' | 'happy' | 'confused' | 'angry'
    inner_heart: string
    response: string
    narration?: string
    character_image_slot?: string
    world_image_slot?: string
  }
}

export interface RoomSummary {
  id: string
  title: string
  userAlias: string
  character: CharacterSummary
  world: WorldSummary | null
  bridgeProfile: BridgeProfile
  state: RoomStateSummary
  messages: RoomMessage[]
  createdAt: string
  updatedAt: string
  lastMessageAt: string
}

export interface LibraryPayload {
  bookmarks: Array<{ id: string; entityType: EntityType; item: EntitySummary; createdAt: string }>
  recentViews: Array<{ id: string; entityType: EntityType; item: EntitySummary; viewedAt: string }>
  recentRooms: RoomSummary[]
  owned: {
    characters: CharacterSummary[]
    worlds: WorldSummary[]
  }
}

export interface OwnerOpsDashboard {
  items: {
    visibleCharacters: CharacterSummary[]
    hiddenCharacters: CharacterSummary[]
    visibleWorlds: WorldSummary[]
    hiddenWorlds: WorldSummary[]
  }
  home: {
    heroMode: 'auto' | 'manual'
    heroTargetPath: string
  }
}

export interface RoomChatResponse {
  room: RoomSummary
  message: Extract<RoomMessage['content'], object>
  trace_id: string
}
