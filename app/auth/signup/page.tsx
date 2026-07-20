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

export default function SignupPage() {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)

  useEffect(() => {
    setBrand(detectBrand())
  }, [])

  const [form, setForm] = useState({ businessName: '', email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    // Industry is no longer collected at signup — default from the brand (e.g. the
    // locksmith brand), otherwise "Other". It's editable later on the agent page.
    const industry = brand.industry || 'Other'
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          businessName: form.businessName,
          industry,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      })
      if (signInError) throw signInError

      // Create the first agent + provision its number, then land directly on its
      // edit page — that page IS the onboarding. Fall back to the classic flow if
      // bootstrap fails, so signup is never a dead end.
      try {
        const boot = await fetch('/api/onboarding/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessName: form.businessName, businessType: industry, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        })
        const bj = await boot.json().catch(() => ({}))
        if (boot.ok && bj.employeeId) {
          window.location.href = `/ai-employees/${bj.employeeId}?onboarding=1`
          return
        }
      } catch { /* fall through */ }
      // Fallback if bootstrap didn't return an agent: the New Employee path (same full
      // edit-page experience) creates + provisions and lands on the page. No wizard.
      window.location.href = '/ai-employees/new'
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Signup failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      brandLogo={brand.logo}
      headline="Create your AI employee."
      subheadline="Start automating every conversation in minutes."
    >
      <form onSubmit={handleSignup} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="businessName" className="text-sm font-medium text-ink">Business name</label>
          <input
            id="businessName"
            required
            value={form.businessName}
            onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
            placeholder="Smith's Locksmith Services"
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-ink">Work email</label>
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="you@company.com"
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-ink">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              minLength={8}
              required
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Min. 8 characters"
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-danger/20 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        {/* Legal — subtle text directly above Continue. */}
        <p className="text-[10px] leading-snug text-muted/70">
          By creating an account, you agree to our{' '}
          <a href="https://scalix26.com/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">Terms of Service</a>{' '}
          and{' '}
          <a href="https://scalix26.com/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">Privacy Policy</a>.
        </p>

        <Button
          type="submit"
          loading={loading}
          className="mt-1 h-12 w-full rounded-xl bg-black text-[15px] font-medium text-white shadow-sm transition-all hover:bg-black/90 hover:shadow-md"
        >
          Continue
        </Button>

        <p className="text-center text-xs text-muted">
          {brand.trialDays}-day free trial &middot; no credit card required
        </p>
      </form>

      <p className="mt-8 text-center text-sm text-subtle">
        Already have an account?{' '}
        <Link href="/auth/login" className="font-medium text-ink transition-opacity hover:opacity-70">
          Sign in &rarr;
        </Link>
      </p>
    </AuthShell>
  )
}
