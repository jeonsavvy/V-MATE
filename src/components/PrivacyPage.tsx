import { PageSection, PlatformShell } from '@/components/platform/PlatformScaffold'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

const privacySections = [
  {
    title: '1. 처리하는 개인정보 항목',
    items: [
      '회원 인증을 위해 이메일 주소, 인증 식별자, 로그인 세션 정보를 처리합니다.',
      '서비스 이용을 위해 프로필 정보, 캐릭터·월드 생성 내용, 플레이 룸, 대화 메시지, 즐겨찾기, 최근 보기 기록을 처리합니다.',
      '이미지 기능 제공을 위해 이용자가 업로드한 캐릭터·월드 이미지와 파생 이미지를 처리합니다.',
      '부정 이용 방지와 안정적인 API 제공을 위해 요청 시각, Origin, User-Agent, IP 또는 fingerprint 기반 rate-limit 식별정보를 처리할 수 있습니다.',
    ],
  },
  {
    title: '2. 개인정보의 처리 목적',
    items: [
      '회원 가입, 로그인, 계정 식별, 대화 기록 및 보관함 제공에 사용합니다.',
      '캐릭터·월드 제작, 대화방 생성, 장기 대화 맥락 유지, 이미지 업로드 및 표시 기능 제공에 사용합니다.',
      '운영자 권한 확인, 부정 이용 방지, 장애 대응, 서비스 품질 개선에 사용합니다.',
    ],
  },
  {
    title: '3. 보유 및 이용 기간',
    items: [
      '계정 정보와 이용자가 만든 콘텐츠는 회원 탈퇴 또는 삭제 요청 시까지 보관합니다.',
      '대화방, 메시지, 즐겨찾기, 최근 보기 기록은 서비스 이용 이력 제공에 필요한 기간 동안 보관합니다.',
      '보안 및 장애 대응 목적의 요청 식별정보는 목적 달성 후 지체 없이 파기하며, 법령상 보존 의무가 있는 경우 해당 기간 동안 보관합니다.',
    ],
  },
  {
    title: '4. 제3자 제공 및 처리위탁',
    items: [
      '서비스 제공을 위해 Supabase, Cloudflare, Google Gemini API 및 이미지 저장소를 사용할 수 있습니다.',
      '법령에 근거가 있거나 이용자의 동의가 있는 경우를 제외하고 개인정보를 외부에 판매하거나 목적 외로 제공하지 않습니다.',
    ],
  },
  {
    title: '5. 정보주체의 권리',
    items: [
      '이용자는 개인정보 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다.',
      '요청은 아래 개인정보 문의 이메일로 접수하며, 본인 확인 후 관련 법령에 따라 처리합니다.',
    ],
  },
  {
    title: '6. 안전성 확보 조치',
    items: [
      '인증이 필요한 기능은 Supabase Auth 세션을 확인한 뒤 제공하며, 서버 전용 키와 운영 비밀값은 브라우저에 노출하지 않습니다.',
      '채팅 API는 Origin 정책, 인증 정책, rate limit, 요청 dedupe 및 로그 민감정보 마스킹을 통해 보호합니다.',
    ],
  },
] as const

export function PrivacyPage({ chrome }: { chrome: PlatformPageChromeProps }) {
  return (
    <PlatformShell
      user={chrome.user}
      userAvatarInitial={chrome.userAvatarInitial}
      searchValue={chrome.searchQuery}
      onSearchChange={chrome.onSearchChange}
      onNavigate={chrome.onNavigate}
      onAuthRequest={chrome.onAuthRequest}
      onSignOut={chrome.onSignOut}
      onDeleteAccount={chrome.onDeleteAccount}
      showCombinationDock={false}
    >
      <div className="space-y-6">
        <section className="border-b border-[#e7e7e7] pb-6 pt-1">
          <h1 className="text-[clamp(2rem,4vw,3.2rem)] font-semibold tracking-[-0.04em] text-[#171717]">개인정보처리방침</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[#666]">
            V-MATE는 캐릭터와 월드 기반 대화 서비스를 제공하기 위해 필요한 최소한의 개인정보를 처리합니다.
          </p>
        </section>

        <PageSection title="기본 정보">
          <div className="grid gap-3 text-sm text-[#666] md:grid-cols-3">
            <div className="rounded-lg border border-[#e7e7e7] bg-[#fafafa] p-4">
              <p className="font-semibold text-[#171717]">개인정보처리자</p>
              <p className="mt-2">전찬혁</p>
            </div>
            <div className="rounded-lg border border-[#e7e7e7] bg-[#fafafa] p-4">
              <p className="font-semibold text-[#171717]">개인정보 문의</p>
              <a href="mailto:jeonsavvy@gmail.com" className="mt-2 inline-block underline-offset-4 hover:underline">jeonsavvy@gmail.com</a>
            </div>
            <div className="rounded-lg border border-[#e7e7e7] bg-[#fafafa] p-4">
              <p className="font-semibold text-[#171717]">시행일</p>
              <p className="mt-2">2026년 3월 1일</p>
            </div>
          </div>
        </PageSection>

        {privacySections.map((section) => (
          <PageSection key={section.title} title={section.title}>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-[#666]">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </PageSection>
        ))}
      </div>
    </PlatformShell>
  )
}
