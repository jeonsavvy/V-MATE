import type { User as SupabaseUser } from "@supabase/supabase-js"
import type { Character } from "@/lib/data"
import {
  formatRelativeTime,
  HERO_SIGNALS,
  STORY_FLOW_STEPS,
  useHomeController,
} from "@/hooks/useHomeController"
import { CharacterDetailSheet } from "./CharacterDetailSheet"
import { HomeHeaderBar } from "@/components/home/HomeHeaderBar"
import { HomeHeroSection } from "@/components/home/HomeHeroSection"
import { HomeStoryFlowSection } from "@/components/home/HomeStoryFlowSection"
import { HomeCuratedPicksSection } from "@/components/home/HomeCuratedPicksSection"
import { HomeCharacterBrowseSection } from "@/components/home/HomeCharacterBrowseSection"

interface HomeProps {
  onCharacterSelect: (character: Character) => void
  user: SupabaseUser | null
  onAuthRequest: () => void
}

export function Home({ onCharacterSelect, user, onAuthRequest }: HomeProps) {
  const {
    searchQuery,
    setSearchQuery,
    activeFilter,
    setActiveFilter,
    setSelectedCharacterId,
    recentChats,
    filteredCharacters,
    heroCharacters,
    primaryCharacter,
    primaryCharacterMeta,
    recentContinuation,
    selectedCharacter,
    selectedCharacterMeta,
    userAvatarInitial,
    handleSignOut,
    characterFilters,
  } = useHomeController({ user })

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#e8e1d5] pb-[calc(5rem+env(safe-area-inset-bottom))] text-[#1f2128]">
      <a
        href="#home-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#2f3138]"
      >
        메인 콘텐츠로 건너뛰기
      </a>

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(109,91,72,0.12),transparent_30%),radial-gradient(circle_at_85%_14%,rgba(116,108,139,0.18),transparent_34%),radial-gradient(circle_at_82%_80%,rgba(95,124,146,0.16),transparent_36%)]" />
        <div className="absolute -top-28 left-1/2 h-72 w-[34rem] -translate-x-1/2 rounded-full bg-[#d6cbba]/70 blur-[120px]" />
      </div>

      <HomeHeaderBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        user={user}
        userAvatarInitial={userAvatarInitial}
        onAuthRequest={onAuthRequest}
        onSignOut={handleSignOut}
      />

      <main id="home-main-content" className="relative z-10 mx-auto w-full max-w-[1280px] space-y-10 px-4 py-5 md:py-6 lg:space-y-12">
        <HomeHeroSection
          primaryCharacter={primaryCharacter}
          primaryHeroQuote={primaryCharacterMeta?.heroQuote ?? primaryCharacter.greeting}
          primaryObjectPosition={primaryCharacterMeta?.heroObjectPosition}
          recentChatsCount={recentChats.length}
          recentContinuation={recentContinuation}
          onCharacterSelect={onCharacterSelect}
          onSelectCharacterDetail={setSelectedCharacterId}
          formatRelativeTime={formatRelativeTime}
        />

        <HomeStoryFlowSection steps={STORY_FLOW_STEPS} />

        <HomeCuratedPicksSection
          heroCharacters={heroCharacters}
          heroSignals={HERO_SIGNALS}
          onSelectCharacterDetail={setSelectedCharacterId}
        />

        <HomeCharacterBrowseSection
          filteredCharacters={filteredCharacters}
          characterFilters={characterFilters}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          onSelectCharacterDetail={setSelectedCharacterId}
        />
      </main>

      <footer className="relative z-10 px-4 pb-6 text-center text-xs text-[#7f776c]">
        © V-MATE. All Rights Reserved.
      </footer>

      {selectedCharacter && selectedCharacterMeta && (
        <CharacterDetailSheet
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelectedCharacterId(null)
            }
          }}
          character={selectedCharacter}
          meta={selectedCharacterMeta}
          onStartChat={() => onCharacterSelect(selectedCharacter)}
        />
      )}
    </div>
  )
}
