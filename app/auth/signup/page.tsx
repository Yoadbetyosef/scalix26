'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Zap, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export default function SignupPage() {
  const [form, setForm] = useState({
    businessName: '',
    email: '',
    password: '',
    industry: '',
  })
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const industries = [
    'HVAC', 'Plumbing', 'Electrical', 'Cleaning', 'Landscaping',
    'Roofing', 'Pest Control', 'Handyman', 'Pool Service', 'Other',
  ]

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
      })
      if (error) throw error

      if (data.user) {
        // Create tenant
        const { error: tenantError } = await supabase.from('tenants').insert({
          user_id: data.user.id,
          business_name: form.businessName,
          industry: form.industry,
          email: form.email,
          plan: 'trial',
        })
        if (tenantError) throw tenantError

        // Redirect to onboarding (AI employee wizard)
        router.push('/ai-employees/new?onboarding=true')
        router.refresh()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-[#4ecdc4] rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-[#1a1f36]">Scalix26</span>
        </div>

        {/* Trial benefits */}
        <div className="bg-[#4ecdc4]/10 rounded-xl p-4 mb-6 border border-[#4ecdc4]/20">
          <p className="text-sm font-medium text-[#1a1f36] mb-2">14-day free trial includes:</p>
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
                placeholder="Smith's HVAC Services"
                value={form.businessName}
                onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <select
                id="industry"
                className="flex h-10 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#4ecdc4] focus:border-transparent"
                value={form.industry}
                onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                required
              >
                <option value="">Select industry</option>
                {industries.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
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
