'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { type BrandConfig, DEFAULT_BRAND, detectBrand } from '@/lib/brands'

export default function UpdatePasswordPage() {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)   // a recovery session is active → the form is usable
  const [linkError, setLinkError] = useState(false) // no valid session → the link is invalid/expired
  const router = useRouter()
  const supabase = createClient()

  // The reset link lands here carrying the recovery session (Supabase parses the token in the URL).
  // We must CONFIRM that session exists before allowing updateUser — otherwise the update silently
  // fails with "Auth session missing", which is why resets "didn't work". Enable the form only once a
  // recovery session is live; if none appears, show a clear "request a new link" message.
  useEffect(() => {
    setBrand(detectBrand())
    let mounted = true
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || session) setReady(true)
    })
    ;(async () => {
      // PKCE fallback: if the link used a ?code=, exchange it for a session.
      try {
        const code = new URLSearchParams(window.location.search).get('code')
        if (code) await supabase.auth.exchangeCodeForSession(code)
      } catch { /* the session check below decides the outcome */ }
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      if (data.session) { setReady(true); return }
      // Give detectSessionInUrl a beat to parse the URL hash, then decide it's invalid/expired.
      setTimeout(async () => {
        const { data: d2 } = await supabase.auth.getSession()
        if (mounted && !d2.session) setLinkError(true)
      }, 1800)
    })()
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [supabase])

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      toast.error('Passwords do not match')
      return
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast.success('Password updated successfully!')
      // Route through the server-side plane decision (partners → /partner, business → /dashboard).
      router.push('/')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center mb-8">
          {brand.logo}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-hairline p-8">
          {linkError ? (
            <div className="text-center">
              <h1 className="text-2xl font-bold text-ink mb-2">Link expired</h1>
              <p className="text-subtle mb-6">This password reset link is invalid or has expired. Request a new one and we&apos;ll email it right over.</p>
              <Link href="/auth/forgot-password">
                <Button className="w-full">Request a new link</Button>
              </Link>
            </div>
          ) : !ready ? (
            <div className="text-center py-6">
              <h1 className="text-2xl font-bold text-ink mb-2">Set new password</h1>
              <p className="text-subtle">Validating your reset link…</p>
            </div>
          ) : (
          <>
          <h1 className="text-2xl font-bold text-ink mb-2">Set new password</h1>
          <p className="text-subtle mb-6">Choose a strong password for your account</p>

          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" loading={loading}>
              Update Password
            </Button>
          </form>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
