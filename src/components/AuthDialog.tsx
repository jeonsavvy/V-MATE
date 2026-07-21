import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { devError } from "@/lib/logger"
import { buildBrowserRedirectUrl, getBrowserOrigin } from "@/lib/browserRuntime"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"

interface AuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const resolveErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) {
      return message
    }
  }

  return fallback
}

export function AuthDialog({ open, onOpenChange, onSuccess }: AuthDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isResetLoading, setIsResetLoading] = useState(false)
  const [isResetFormOpen, setIsResetFormOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("signin")

  const [signInEmail, setSignInEmail] = useState("")
  const [signInPassword, setSignInPassword] = useState("")
  const [signUpName, setSignUpName] = useState("")
  const [signUpEmail, setSignUpEmail] = useState("")
  const [signUpPassword, setSignUpPassword] = useState("")
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState("")
  const [signUpAgeConfirmed, setSignUpAgeConfirmed] = useState(false)
  const [resetEmail, setResetEmail] = useState("")

  useEffect(() => {
    if (activeTab !== "signin") {
      setIsResetFormOpen(false)
    }
  }, [activeTab])

  const getSupabaseClient = async () => {
    const module = await import("@/lib/supabase")
    if (!module.isSupabaseConfigured()) {
      return null
    }
    return module.resolveSupabaseClient()
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()

    const supabase = await getSupabaseClient()
    if (!supabase) {
      toast.error("Supabase가 설정되지 않았습니다. 환경 변수를 확인해주세요.")
      return
    }

    setIsLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password: signInPassword,
      })

      if (error) throw error

      toast.success("로그인 성공")
      onOpenChange(false)
      setSignInEmail("")
      setSignInPassword("")
      onSuccess?.()
    } catch (error: unknown) {
      toast.error(resolveErrorMessage(error, "로그인에 실패했습니다"))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()

    const supabase = await getSupabaseClient()
    if (!supabase) {
      toast.error("Supabase가 설정되지 않았습니다. 환경 변수를 확인해주세요.")
      return
    }

    if (signUpPassword !== signUpConfirmPassword) {
      toast.error("비밀번호가 일치하지 않습니다.")
      return
    }
    if (!signUpAgeConfirmed) {
      toast.error("V-MATE는 만 17세 이상만 가입할 수 있습니다.")
      return
    }

    setIsLoading(true)

    try {
      const redirectOrigin = getBrowserOrigin()
      const { data, error } = await supabase.auth.signUp({
        email: signUpEmail,
        password: signUpPassword,
        options: {
          data: {
            name: signUpName,
            ageConfirmed: true,
          },
          ...(redirectOrigin ? { emailRedirectTo: redirectOrigin } : {}),
        },
      })

      if (error) {
        const normalizedMessage = resolveErrorMessage(error, "").toLowerCase()
        if (normalizedMessage.includes("secret") || normalizedMessage.includes("forbidden")) {
          toast.error("Supabase 설정 오류입니다. 관리자에게 문의해주세요.")
          devError("Supabase auth error:", error)
          return
        }
        throw error
      }

      if (data.user) {
        if (data.session) {
          toast.success("회원가입 및 로그인 성공")
          onOpenChange(false)
          setSignUpEmail("")
          setSignUpPassword("")
          setSignUpConfirmPassword("")
          setSignUpName("")
          setSignUpAgeConfirmed(false)
          onSuccess?.()
        } else {
          toast.success("회원가입 성공! 이메일을 확인해주세요.")
          onOpenChange(false)
          setSignUpEmail("")
          setSignUpPassword("")
          setSignUpConfirmPassword("")
          setSignUpName("")
          setSignUpAgeConfirmed(false)
        }
      }
    } catch (error: unknown) {
      devError("Sign up error:", error)
      toast.error(resolveErrorMessage(error, "회원가입에 실패했습니다"))
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async () => {
    const supabase = await getSupabaseClient()
    if (!supabase) {
      toast.error("Supabase가 설정되지 않았습니다. 환경 변수를 확인해주세요.")
      return
    }

    const normalizedResetEmail = resetEmail.trim()
    if (!normalizedResetEmail) {
      toast.error("아이디(이메일)를 입력해주세요.")
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedResetEmail)) {
      toast.error("올바른 이메일 형식을 입력해주세요.")
      return
    }

    setIsResetLoading(true)
    try {
      const redirectTo = buildBrowserRedirectUrl("/")
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedResetEmail, {
        redirectTo,
      })

      if (error) throw error
      toast.success("비밀번호 재설정 메일을 발송했습니다.")
      setIsResetFormOpen(false)
      setResetEmail("")
    } catch (error: unknown) {
      toast.error(resolveErrorMessage(error, "비밀번호 재설정 메일 발송에 실패했습니다"))
    } finally {
      setIsResetLoading(false)
    }
  }

  const handleOpenResetForm = () => {
    setIsResetFormOpen(true)
    setResetEmail("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto rounded-xl p-6 sm:max-w-lg">
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle>로그인</DialogTitle>
          <DialogDescription>채팅을 시작하려면 로그인 또는 회원가입이 필요합니다.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">로그인</TabsTrigger>
            <TabsTrigger value="signup">회원가입</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-semibold text-foreground">이메일</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="hello@example.com"
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm font-semibold text-foreground">비밀번호</Label>
                    <Input
                      id="password"
                      type="password"
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenResetForm}
                    disabled={isResetLoading || isLoading}
                    className="text-xs font-semibold text-muted-foreground underline-offset-2 transition hover:text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    비밀번호를 잊으셨나요?
                  </button>

                  {isResetFormOpen && (
                    <div className="space-y-3 rounded-xl border border-border bg-secondary p-4 shadow-inner-line">
                      <div className="space-y-2">
                        <Label htmlFor="reset-email" className="text-sm font-semibold text-foreground">아이디(이메일)</Label>
                        <Input
                          id="reset-email"
                          type="email"
                          placeholder="가입한 이메일을 입력하세요"
                          value={resetEmail}
                          onChange={(event) => setResetEmail(event.target.value)}
                          disabled={isResetLoading || isLoading}
                          autoComplete="email"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={handleResetPassword} disabled={isResetLoading || isLoading}>
                          {isResetLoading ? "발송 중..." : "재설정 메일 발송"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsResetFormOpen(false)}
                          disabled={isResetLoading || isLoading}
                        >
                          취소
                        </Button>
                      </div>
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    로그인
                  </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm font-semibold text-foreground">이름</Label>
                    <Input
                      id="name"
                      placeholder="표시할 이름"
                      value={signUpName}
                      onChange={(e) => setSignUpName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="text-sm font-semibold text-foreground">이메일</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="hello@example.com"
                      value={signUpEmail}
                      onChange={(e) => setSignUpEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="text-sm font-semibold text-foreground">비밀번호</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-muted-foreground">영문/숫자 포함 6자 이상을 권장합니다.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password-confirm" className="text-sm font-semibold text-foreground">비밀번호 확인</Label>
                    <Input
                      id="signup-password-confirm"
                      type="password"
                      value={signUpConfirmPassword}
                      onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                  </div>
                  <label className="flex items-start gap-3 rounded-lg border border-border bg-secondary/35 p-3 text-sm text-muted-foreground">
                    <input type="checkbox" checked={signUpAgeConfirmed} onChange={(event) => setSignUpAgeConfirmed(event.target.checked)} className="mt-0.5 size-4 accent-[#ff5148]" />
                    <span><strong className="text-foreground">만 17세 이상입니다.</strong><br />로맨스·갈등·비노골적 폭력 표현이 포함될 수 있습니다.</span>
                  </label>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    회원가입
                  </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
