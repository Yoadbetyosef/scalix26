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

const TYPES = [
  { key: 'affiliate', label: 'Affiliate — refer & earn' },
  { key: 'growth', label: 'Growth Partner' },
  { key: 'agency', label: 'Agency (team + white-label)' },
  { key: 'enterprise', label: 'Enterprise Partner' },
]

export default function PartnerSignupPage() {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  useEffect(() => { setBrand(detectBrand()) }, [])

  const [form, setForm] = useState({ companyName: '', email: '', password: '', partnerType: 'affiliate' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const supabase = createClient()

  // If an existing customer is already signed in, offer the viral one-click "become a partner"
  // path (reuses their identity — no new account) instead of the signup form.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (data.user?.email) setSessionEmail(data.user.email) })
  }, [])

  async function becomePartner() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/partner/become', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: form.companyName }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      window.location.href = '/partner'
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed'
      setError(msg); toast.error(msg)
    } finally { setLoading(false) }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/partner/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
      if (signInError) throw signInError
      window.location.href = '/partner'
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Signup failed'
      setError(msg); toast.error(msg)
    } finally { setLoading(false) }
  }

  if (sessionEmail) {
    return (
      <AuthShell brandLogo={brand.logo} headline="Become a Scalix26 partner." subheadline="Turn your account into a recurring revenue stream. Refer, sell, and earn.">
        <div className="space-y-4">
          <p className="text-sm text-subtle">You&apos;re signed in as <span className="font-medium text-ink">{sessionEmail}</span>. Activate your partner account in one click — no new login.</p>
          <div className="space-y-2">
            <label htmlFor="companyName" className="text-sm font-medium text-ink">Company / your name</label>
            <input id="companyName" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="Acme Growth Agency" className={inputClass} />
          </div>
          {error && <div className="rounded-xl border border-danger/20 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{error}</div>}
          <Button type="button" loading={loading} onClick={becomePartner}
            className="mt-1 h-12 w-full rounded-xl bg-black text-[15px] font-medium text-white shadow-sm transition-all hover:bg-black/90 hover:shadow-md">
            Activate partner account
          </Button>
          <p className="text-center text-xs text-muted">Want a separate partner login instead? <a href="/partner/login" className="underline">Sign in here</a>.</p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell brandLogo={brand.logo} headline="Build a business on Scalix26." subheadline="Join the partner program. Refer, sell, and earn recurring commission.">
      <form onSubmit={handleSignup} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="companyName" className="text-sm font-medium text-ink">Company / your name</label>
          <input id="companyName" required value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            placeholder="Acme Growth Agency" className={inputClass} />
        </div>
        <div className="space-y-2">
          <label htmlFor="partnerType" className="text-sm font-medium text-ink">Partner type</label>
          <select id="partnerType" value={form.partnerType}
            onChange={(e) => setForm((f) => ({ ...f, partnerType: e.target.value }))}
            className={inputClass}>
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-ink">Work email</label>
          <input id="email" type="email" required value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="you@company.com" className={inputClass} />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-ink">Password</label>
          <div className="relative">
            <input id="password" type={showPassword ? 'text' : 'password'} minLength={8} required value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Min. 8 characters" className={`${inputClass} pr-11`} />
            <button type="button" onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-danger/20 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{error}</div>}

        <Button type="submit" loading={loading}
          className="mt-1 h-12 w-full rounded-xl bg-black text-[15px] font-medium text-white shadow-sm transition-all hover:bg-black/90 hover:shadow-md">
          Create partner account
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-subtle">
        Already a partner?{' '}
        <Link href="/partner/login" className="font-medium text-ink transition-opacity hover:opacity-70">Sign in &rarr;</Link>
      </p>
    </AuthShell>
  )
}
