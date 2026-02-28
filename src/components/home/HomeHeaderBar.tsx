import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, Search } from "lucide-react"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { maskEmailAddress } from "@/lib/privacy"

interface HomeHeaderBarProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  user: SupabaseUser | null
  userAvatarInitial: string
  onAuthRequest: () => void
  onSignOut: () => void
}

export function HomeHeaderBar({
  searchQuery,
  onSearchChange,
  user,
  userAvatarInitial,
  onAuthRequest,
  onSignOut,
}: HomeHeaderBarProps) {
  const maskedUserEmail = user ? maskEmailAddress(user.email) : ""

  return (
    <header className="sticky top-0 z-30 border-b border-white/40 bg-[#ece4d8]/80 px-4 py-3 shadow-[0_16px_34px_-30px_rgba(28,26,22,0.75)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1280px] items-center gap-3">
        <div className="shrink-0 text-2xl font-black tracking-tight text-[#7b5cb8]">V-MATE</div>

        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d756b]" />
          <Input
            type="search"
            placeholder="검색어를 입력해 주세요"
            className="h-10 rounded-full border-[#c8beaf] bg-white/75 pl-9 text-[#2a2b30] placeholder:text-[#847c72] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-all focus:border-[#8b6cc7] focus:bg-white"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label="캐릭터 검색"
          />
        </div>

        <div className="shrink-0">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="프로필 메뉴 열기"
                  className="h-8 w-8 cursor-pointer rounded-full bg-gradient-to-tr from-[#9d8ab9] to-[#cba2bb] p-[2px]"
                >
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-xs font-black text-[#6e5f8e]">
                    {userAvatarInitial}
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-[#cbc2b2] bg-[#f6f2eb]/98 text-[#21232a] shadow-[0_18px_35px_-26px_rgba(28,27,23,0.75)]">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{user.user_metadata?.name || "사용자"}</span>
                    <span className="text-xs font-normal text-[#8f8b82]">{maskedUserEmail || "이메일 비공개"}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-black/10" />
                <DropdownMenuItem onClick={onSignOut} className="text-red-500 focus:bg-red-500/10 focus:text-red-500">
                  <LogOut className="mr-2 h-4 w-4" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <span className="hidden rounded-full border border-[#d3c6b4] bg-white/80 px-3 py-1 text-[11px] font-semibold text-[#665f56] md:inline-flex">
                회원 전용 채팅
              </span>
              <Button
                onClick={onAuthRequest}
                className="h-10 rounded-full bg-[#7b5cb8] px-5 text-white shadow-[0_12px_24px_-16px_rgba(123,92,184,0.92)] transition hover:bg-[#6b4fa6]"
              >
                로그인
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
