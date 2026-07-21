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
  let message = ""
  if (error instanceof Error && error.message) {
    message = error.message
  } else if (typeof error === "object" && error !== null && "message" in error) {
    const candidate = (error as { message?: unknown }).message
    if (typeof candidate === "string") message = candidate
  }

  const normalized = message.trim().toLowerCase()
  if (normalized.includes("invalid login credentials")) return "이메일 또는 비밀번호를 확인해 주세요."
  if (normalized.includes("email not confirmed")) return "이메일 인증을 먼저 완료해 주세요."
  if (normalized.includes("user already registered")) return "이미 가입된 이메일입니다."
  if (normalized.includes("password should be at least")) return "비밀번호는 6자 이상이어야 합니다."
  return message.trim() || fallback
}

export function AuthDialog({ open, onOpenChange, onSuccess }: AuthDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isResetLoading, setIsResetLoading] = useState(false)
  const [isResetFormOpen, setIsResetFormOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("signin")
  const [authError, setAuthError] = useState("")

  const [signInEmail, setSignInEmail] = useState("")
  const [signInPassword, setSignInPassword] = useState("")
  const [signUpName, setSignUpName] = useState("")
  const [signUpEmail, setSignUpEmail] = useState("")
  const [signUpPassword, setSignUpPassword] = useState("")
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState("")
  const [resetEmail, setResetEmail] = useState("")

  useEffect(() => {
    setAuthError("")
    if (activeTab !== "signin") {
      setIsResetFormOpen(false)
    }
  }, [activeTab])

  useEffect(() => {
    if (open) setAuthError("")
  }, [open])

  const getSupabaseClient = async () => {
    const module = await import("@/lib/supabase")
    if (!module.isSupabaseConfigured()) {
      return null
    }
    return module.resolveSupabaseClient()
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError("")

    const supabase = await getSupabaseClient()
    if (!supabase) {
      setAuthError("지금은 로그인할 수 없습니다. 잠시 후 다시 시도해 주세요.")
      return
    }

    setIsLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password: signInPassword,
      })

      if (error) throw error

      onOpenChange(false)
      setSignInEmail("")
      setSignInPassword("")
      onSuccess?.()
    } catch (error: unknown) {
      setAuthError(resolveErrorMessage(error, "로그인하지 못했습니다. 다시 시도해 주세요."))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError("")

    const supabase = await getSupabaseClient()
    if (!supabase) {
      setAuthError("지금은 가입할 수 없습니다. 잠시 후 다시 시도해 주세요.")
      return
    }

    if (signUpPassword !== signUpConfirmPassword) {
      setAuthError("비밀번호가 일치하지 않습니다.")
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
          },
          ...(redirectOrigin ? { emailRedirectTo: redirectOrigin } : {}),
        },
      })

      if (error) {
        const normalizedMessage = resolveErrorMessage(error, "").toLowerCase()
        if (normalizedMessage.includes("secret") || normalizedMessage.includes("forbidden")) {
          setAuthError("지금은 가입할 수 없습니다. 잠시 후 다시 시도해 주세요.")
          devError("Supabase auth error:", error)
          return
        }
        throw error
      }

      if (data.user) {
        if (data.session) {
          onOpenChange(false)
          setSignUpEmail("")
          setSignUpPassword("")
          setSignUpConfirmPassword("")
          setSignUpName("")
          onSuccess?.()
        } else {
          toast.success("확인 메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.")
          onOpenChange(false)
          setSignUpEmail("")
          setSignUpPassword("")
          setSignUpConfirmPassword("")
          setSignUpName("")
        }
      }
    } catch (error: unknown) {
      devError("Sign up error:", error)
      setAuthError(resolveErrorMessage(error, "가입하지 못했습니다. 다시 시도해 주세요."))
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async () => {
    const supabase = await getSupabaseClient()
    if (!supabase) {
      setAuthError("지금은 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.")
      return
    }

    const normalizedResetEmail = resetEmail.trim()
    if (!normalizedResetEmail) {
      setAuthError("이메일을 입력해 주세요.")
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedResetEmail)) {
      setAuthError("올바른 이메일 형식을 입력해 주세요.")
      return
    }

    setIsResetLoading(true)
    setAuthError("")
    try {
      const redirectTo = buildBrowserRedirectUrl("/")
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedResetEmail, {
        redirectTo,
      })

      if (error) throw error
      toast.success("비밀번호 재설정 메일을 보냈습니다.")
      setIsResetFormOpen(false)
      setResetEmail("")
    } catch (error: unknown) {
      setAuthError(resolveErrorMessage(error, "재설정 메일을 보내지 못했습니다. 다시 시도해 주세요."))
    } finally {
      setIsResetLoading(false)
    }
  }

  const handleOpenResetForm = () => {
    setIsResetFormOpen(true)
    setResetEmail("")
    setAuthError("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto rounded-xl p-6 sm:max-w-lg">
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle>로그인</DialogTitle>
          <DialogDescription>대화를 시작하고 기록을 저장하려면 로그인하세요.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">로그인</TabsTrigger>
            <TabsTrigger value="signup">회원가입</TabsTrigger>
          </TabsList>

          {authError ? <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{authError}</p> : null}

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-semibold text-foreground">이메일</Label>
                    <Input
                      id="email"
                      name="email"
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
                      name="password"
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
                    className="inline-flex min-h-11 items-center text-xs font-semibold text-muted-foreground underline-offset-2 transition hover:text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    비밀번호를 잊으셨나요?
                  </button>

                  {isResetFormOpen && (
                    <div className="space-y-3 rounded-xl border border-border bg-secondary p-4 shadow-inner-line">
                      <div className="space-y-2">
                        <Label htmlFor="reset-email" className="text-sm font-semibold text-foreground">이메일</Label>
                        <Input
                          id="reset-email"
                          name="reset-email"
                          type="email"
                          placeholder="hello@example.com"
                          value={resetEmail}
                          onChange={(event) => setResetEmail(event.target.value)}
                          disabled={isResetLoading || isLoading}
                          autoComplete="email"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={handleResetPassword} disabled={isResetLoading || isLoading}>
                          {isResetLoading ? "발송 중…" : "재설정 메일 발송"}
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
                    {isLoading ? "로그인 중…" : "로그인"}
                  </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm font-semibold text-foreground">이름</Label>
                    <Input
                      id="name"
                      name="name"
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
                      name="email"
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
                      name="password"
                      type="password"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-muted-foreground">6자 이상</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password-confirm" className="text-sm font-semibold text-foreground">비밀번호 확인</Label>
                    <Input
                      id="signup-password-confirm"
                      name="password-confirm"
                      type="password"
                      value={signUpConfirmPassword}
                      onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isLoading ? "가입 중…" : "회원가입"}
                  </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
