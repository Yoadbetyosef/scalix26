'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { type BrandConfig, DEFAULT_BRAND, detectBrand } from '@/lib/brands'
import { AuthShell } from '@/components/auth/auth-shell'

const inputClass =
  'h-12 w-full rounded-xl border border-hairline bg-white px-4 text-[15px] text-ink placeholder:text-muted outline-none transition-shadow duration-200 focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.05)]'

export default function PartnerLoginPage() {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  useEffect(() => { setBrand(detectBrand()) }, [])

  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
      if (signInError) throw signInError
      window.location.href = '/partner'
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed'
      setError(msg); toast.error(msg)
    } finally { setLoading(false) }
  }

  return (
    <AuthShell brandLogo={brand.logo} headline="Welcome back, partner." subheadline="Sign in to your distribution dashboard.">
      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-ink">Email</label>
          <input id="email" type="email" required value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="you@company.com" className={inputClass} />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-ink">Password</label>
          <div className="relative">
            <input id="password" type={showPassword ? 'text' : 'password'} required value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Your password" className={`${inputClass} pr-11`} />
            <button type="button" onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="text-right">
          <Link href="/auth/forgot-password" className="text-xs text-muted transition-colors hover:text-ink">Forgot password?</Link>
        </div>

        {error && <div className="rounded-xl border border-danger/20 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{error}</div>}

        <Button type="submit" loading={loading}
          className="mt-1 h-12 w-full rounded-xl bg-black text-[15px] font-medium text-white shadow-sm transition-all hover:bg-black/90 hover:shadow-md">
          Sign in
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-subtle">
        New partner?{' '}
        <Link href="/partner/signup" className="font-medium text-ink transition-opacity hover:opacity-70">Create an account &rarr;</Link>
      </p>
    </AuthShell>
  )
}
