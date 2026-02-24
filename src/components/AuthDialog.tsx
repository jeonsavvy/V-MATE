import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

interface AuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function AuthDialog({ open, onOpenChange, onSuccess }: AuthDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isResetLoading, setIsResetLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("signin")
  
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [name, setName] = useState("")

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!isSupabaseConfigured()) {
      toast.error("Supabase가 설정되지 않았습니다. 환경 변수를 확인해주세요.")
      return
    }
    
    setIsLoading(true)
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      toast.success("로그인 성공!")
      onOpenChange(false)
      setEmail("")
      setPassword("")
      onSuccess?.()
    } catch (error: any) {
      toast.error(error.message || "로그인에 실패했습니다")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!isSupabaseConfigured()) {
      toast.error("Supabase가 설정되지 않았습니다. 환경 변수를 확인해주세요.")
      return
    }
    
    if (password !== confirmPassword) {
      toast.error("비밀번호가 일치하지 않습니다.")
      return
    }

    setIsLoading(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name,
          },
          emailRedirectTo: window.location.origin,
        },
      })

      if (error) {
        if (error.message.includes('secret') || error.message.includes('Forbidden')) {
          toast.error("Supabase 설정 오류입니다. 관리자에게 문의해주세요.")
          console.error("Supabase auth error:", error)
          return
        }
        throw error
      }

      if (data.user) {
        if (data.session) {
          toast.success("회원가입 및 로그인 성공!")
          onOpenChange(false)
          setEmail("")
          setPassword("")
          setConfirmPassword("")
          setName("")
          onSuccess?.()
        } else {
          toast.success("회원가입 성공! 이메일을 확인해주세요.")
          onOpenChange(false)
          setEmail("")
          setPassword("")
          setConfirmPassword("")
          setName("")
        }
      }
    } catch (error: any) {
      console.error("Sign up error:", error)
      toast.error(error.message || "회원가입에 실패했습니다")
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase가 설정되지 않았습니다. 환경 변수를 확인해주세요.")
      return
    }

    if (!email.trim()) {
      toast.error("비밀번호 재설정을 위해 이메일을 입력해주세요.")
      return
    }

    setIsResetLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      })

      if (error) throw error
      toast.success("비밀번호 재설정 메일을 발송했습니다.")
    } catch (error: any) {
      toast.error(error.message || "비밀번호 재설정 메일 발송에 실패했습니다")
    } finally {
      setIsResetLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto border-[#dfd3c3] bg-[#f8f4ec] text-[#1f2128] shadow-[0_30px_56px_-34px_rgba(18,17,15,0.5)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-3xl font-black tracking-[0.03em] text-[#2d3039]">
            V-MATE
          </DialogTitle>
          <DialogDescription className="text-center text-[#716a61]">
            로그인하여 대화 내역을 저장하고 동기화하세요.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-2 border border-[#d8ccba] bg-[#ebe3d7]/80 p-1">
            <TabsTrigger value="signin" className="rounded-md text-[#6c655b] transition data-[state=active]:bg-[#f7f2ea] data-[state=active]:text-[#2f3138] data-[state=active]:shadow-sm">로그인</TabsTrigger>
            <TabsTrigger value="signup" className="rounded-md text-[#6c655b] transition data-[state=active]:bg-[#f7f2ea] data-[state=active]:text-[#2f3138] data-[state=active]:shadow-sm">회원가입</TabsTrigger>
          </TabsList>
          
          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[#6f6a61]">이메일</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="hello@example.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-[#d1c4b3] bg-white/75 text-[#22242b] placeholder:text-[#8f8b82] focus-visible:border-[#8b6cc7]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-[#6f6a61]">비밀번호</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-[#d1c4b3] bg-white/75 text-[#22242b] focus-visible:border-[#8b6cc7]"
                />
              </div>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={isResetLoading || isLoading}
                className="text-xs font-semibold text-[#7a6757] underline-offset-2 transition hover:text-[#6b4fa6] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResetLoading ? "재설정 메일 발송 중..." : "비밀번호를 잊으셨나요?"}
              </button>
              <Button type="submit" className="w-full bg-[#7b5cb8] text-white shadow-[0_14px_26px_-18px_rgba(123,92,184,0.95)] transition hover:bg-[#6b4fa6]" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                로그인
              </Button>
            </form>
          </TabsContent>
          
          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-[#6f6a61]">이름</Label>
                <Input 
                  id="name" 
                  placeholder="표시할 이름" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="border-[#d1c4b3] bg-white/75 text-[#22242b] placeholder:text-[#8f8b82] focus-visible:border-[#8b6cc7]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-[#6f6a61]">이메일</Label>
                <Input 
                  id="signup-email" 
                  type="email" 
                  placeholder="hello@example.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-[#d1c4b3] bg-white/75 text-[#22242b] placeholder:text-[#8f8b82] focus-visible:border-[#8b6cc7]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password" className="text-[#6f6a61]">비밀번호</Label>
                <Input 
                  id="signup-password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="border-[#d1c4b3] bg-white/75 text-[#22242b] focus-visible:border-[#8b6cc7]"
                />
                <p className="text-xs text-[#8a8378]">영문/숫자 포함 6자 이상 권장</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password-confirm" className="text-[#6f6a61]">비밀번호 확인</Label>
                <Input 
                  id="signup-password-confirm" 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="border-[#d1c4b3] bg-white/75 text-[#22242b] focus-visible:border-[#8b6cc7]"
                />
              </div>
              <Button type="submit" className="w-full bg-[#7b5cb8] text-white shadow-[0_14px_26px_-18px_rgba(123,92,184,0.95)] transition hover:bg-[#6b4fa6]" disabled={isLoading}>
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
