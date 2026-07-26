import { FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function PasswordRecoveryPage({ onComplete, onOpenAuth }: { onComplete: () => void; onOpenAuth: () => void }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid' | 'unavailable' | 'submitting' | 'success'>('checking')
  const [retryVersion, setRetryVersion] = useState(0)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let mounted = true
    let unsubscribe: (() => void) | undefined
    void (async () => {
      try {
        const auth = await import('@/lib/supabase')
        if (!auth.isSupabaseConfigured()) { if (mounted) setStatus('invalid'); return }
        const client = await auth.resolveSupabaseClient()
        if (!client) { if (mounted) setStatus('invalid'); return }
        const { data, error: sessionError } = await client.auth.getSession()
        if (sessionError) throw sessionError
        // 인증 SDK가 callback 교환 결과를 확정한 뒤에만 code/token을 제거한다.
        if (window.location.search || window.location.hash) window.history.replaceState({}, '', '/auth/recovery')
        if (mounted) setStatus(data.session ? 'ready' : 'invalid')
        const { data: listener } = client.auth.onAuthStateChange((event, session) => {
          if (mounted && event === 'PASSWORD_RECOVERY') {
            setStatus(session ? 'ready' : 'invalid')
            if (window.location.search || window.location.hash) window.history.replaceState({}, '', '/auth/recovery')
          }
        })
        unsubscribe = () => listener.subscription.unsubscribe()
      } catch {
        // 일시 실패에서는 일회성 callback을 보존해 사용자가 같은 링크로 재시도할 수 있게 한다.
        if (mounted) setStatus('unavailable')
      }
    })()
    return () => { mounted = false; unsubscribe?.() }
  }, [retryVersion])

  useEffect(() => { headingRef.current?.focus() }, [status])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 6) return setError('비밀번호는 6자 이상이어야 합니다.')
    if (password !== confirm) return setError('비밀번호가 일치하지 않습니다.')
    setStatus('submitting'); setError('')
    try {
      const auth = await import('@/lib/supabase')
      const client = auth.isSupabaseConfigured() ? await auth.resolveSupabaseClient() : null
      if (!client) throw new Error('unavailable')
      const { error: updateError } = await client.auth.updateUser({ password })
      if (updateError) throw updateError
      setStatus('success')
    } catch {
      setError('비밀번호를 변경하지 못했습니다. 링크가 만료되었다면 새 재설정 메일을 요청해 주세요.')
      setStatus('ready')
    }
  }

  return <main className="mx-auto flex min-h-dvh max-w-md items-center px-5"><section className="w-full rounded-xl border border-[#e7e7e7] bg-white p-6 shadow-sm"><h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold">새 비밀번호 설정</h1><p className="mt-2 text-sm text-[#666]">안전한 새 비밀번호를 입력해 주세요.</p>{status === 'checking' ? <p role="status" className="mt-5 text-sm text-[#666]">재설정 링크 확인 중…</p> : null}{status === 'invalid' ? <div className="mt-5"><p role="alert" className="text-sm text-[#a42646]">재설정 링크를 확인하지 못했습니다. 새 링크를 요청해 주세요.</p><Button className="mt-4 min-h-11" onClick={onOpenAuth}>로그인에서 재설정 요청</Button></div> : null}{status === 'unavailable' ? <div className="mt-5"><p role="alert" className="text-sm text-[#a42646]">재설정 링크 확인에 실패했습니다. 링크 정보는 유지되었습니다.</p><div className="mt-4 flex flex-wrap gap-2"><Button className="min-h-11" onClick={() => { setStatus('checking'); setRetryVersion((value) => value + 1) }}>다시 확인</Button><Button className="min-h-11" variant="outline" onClick={onOpenAuth}>새 링크 요청</Button></div></div> : null}{status === 'success' ? <div className="mt-5"><p role="status" className="text-sm text-[#177245]">비밀번호를 변경했습니다. 이제 로그인할 수 있습니다.</p><Button className="mt-4 min-h-11" onClick={onComplete}>홈으로 이동</Button></div> : null}{(status === 'ready' || status === 'submitting') ? <form onSubmit={submit} className="mt-5 space-y-4"><Input className="h-11" aria-label="새 비밀번호" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><Input className="h-11" aria-label="새 비밀번호 확인" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />{error ? <p role="alert" className="text-sm text-[#a42646]">{error}</p> : null}<Button className="min-h-11" type="submit" disabled={status === 'submitting'}>{status === 'submitting' ? '변경 중…' : '비밀번호 변경'}</Button></form> : null}</section></main>
}
