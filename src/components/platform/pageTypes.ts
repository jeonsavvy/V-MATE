import type { User as SupabaseUser } from '@supabase/supabase-js'

export interface PlatformPageChromeProps {
  user: SupabaseUser | null
  userAvatarInitial: string
  searchQuery: string
  onSearchChange: (value: string) => void
  onNavigate: (path: string) => void
  onAuthRequest: () => void
  onSignOut: () => void
}
