'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { type BrandConfig, DEFAULT_BRAND, BRANDS, detectBrand } from '@/lib/brands'

export default function SignupPage() {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)

  useEffect(() => {
    const detected = detectBrand()
    setBrand(detected)
    if (detected.industry) {
      setForm(f => ({ ...f, industry: detected.industry! }))
    }
  }, [])

  const [form, setForm] = useState({
    businessName: '',
    email: '',
    password: '',
    industry: brand.industry || '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const industries = [
    'Locksmith', 'HVAC', 'Plumbing', 'Electrical', 'Cleaning', 'Landscaping',
    'Roofing', 'Pest Control', 'Handyman', 'Pool Service', 'Other',
  ]

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          businessName: form.businessName,
          industry: form.industry,
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
          body: JSON.stringify({ businessName: form.businessName, businessType: form.industry }),
        })
        const bj = await boot.json().catch(() => ({}))
        if (boot.ok && bj.employeeId) {
          window.location.href = `/ai-employees/${bj.employeeId}?onboarding=1`
          return
        }
      } catch { /* fall through to the classic onboarding flow */ }
      window.location.href = '/onboarding'
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Signup failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          {brand.logo}
        </div>

        {/* Trial benefits */}
        <div className="bg-[#4ecdc4]/10 rounded-xl p-4 mb-6 border border-[#4ecdc4]/20">
          <p className="text-sm font-medium text-[#1a1f36] mb-2">
            {brand.trialDays}-day free trial includes:
          </p>
          {['1 AI Employee', '500 conversations', 'SMS + Voice', 'No credit card required'].map(f => (
            <div key={f} className="flex items-center gap-2 text-sm text-gray-700">
              <Check className="w-3.5 h-3.5 text-[#4ecdc4]" />
              {f}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Create your account</h1>

          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="businessName">Business Name</Label>
              <Input
                id="businessName"
                placeholder="Smith's Locksmith Services"
                value={form.businessName}
                onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))}
                required
              />
            </div>
            {!brand.industry && (
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <select
                id="industry"
                className="flex h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#4ecdc4] focus:border-transparent"
                value={form.industry}
                onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                required
              >
                <option value="">Select industry</option>
                {industries.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Work Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Min. 8 characters"
                minLength={8}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" loading={loading}>
              Start Free Trial
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-[#4ecdc4] font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
