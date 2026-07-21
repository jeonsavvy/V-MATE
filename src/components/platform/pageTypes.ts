import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { CharacterSummary, EntitySummary, WorldSummary } from '@/lib/platform/types'

export interface PlatformPageChromeProps {
  user: SupabaseUser | null
  userAvatarInitial: string
  searchQuery: string
  onSearchChange: (value: string) => void
  onNavigate: (path: string) => void
  onAuthRequest: () => void
  onSignOut: () => void
  onDeleteAccount: () => Promise<void>
  selectedCharacter: CharacterSummary | null
  selectedWorld: WorldSummary | null
  isStartingCombination: boolean
  onSelectEntity: (item: EntitySummary) => void
  onClearSelectedEntity: (entityType: 'character' | 'world') => void
  onStartCombination: () => Promise<void>
}
