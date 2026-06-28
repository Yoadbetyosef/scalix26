'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { type BrandConfig, DEFAULT_BRAND, detectBrand } from '@/lib/brands'
import { AuthShell } from '@/components/auth/auth-shell'
import { SocialButtons } from '@/components/auth/social-buttons'

const inputClass =
  'h-12 w-full rounded-xl border border-hairline bg-white px-4 text-[15px] text-ink placeholder:text-muted outline-none transition-shadow duration-200 focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.05)]'

export default function LoginPage() {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    setBrand(detectBrand())
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      window.location.href = '/dashboard'
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      brandLogo={brand.logo}
      headline="Welcome back."
      subheadline="Your AI employee has been working while you were away. Sign in to continue managing every conversation from one intelligent workspace."
    >
      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-ink">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-ink">Password</label>
            <Link href="/auth/forgot-password" className="text-xs text-subtle transition-colors hover:text-ink">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>

        <Button
          type="submit"
          loading={loading}
          className="mt-1 h-12 w-full rounded-xl bg-black text-[15px] font-medium text-white shadow-sm transition-all hover:bg-black/90 hover:shadow-md"
        >
          Continue
        </Button>
      </form>

      <div className="my-6 flex items-center gap-4">
        <span className="h-px flex-1 bg-hairline" />
        <span className="text-xs text-muted">or</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <SocialButtons />

      <p className="mt-8 text-center text-sm text-subtle">
        Don&apos;t have an account?{' '}
        <Link href="/auth/signup" className="font-medium text-ink transition-opacity hover:opacity-70">
          Create one &rarr;
        </Link>
      </p>
    </AuthShell>
  )
}
