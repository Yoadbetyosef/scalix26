'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

const INDUSTRIES = [
  'HVAC', 'Plumbing', 'Electrical', 'Cleaning', 'Landscaping',
  'Roofing', 'Pest Control', 'Handyman', 'Pool Service', 'Other',
]

export default function SetupPage() {
  const [businessName, setBusinessName] = useState('')
  const [industry, setIndustry] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')

      const res = await fetch('/api/auth/create-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, industry, userId: user.id, email: user.email }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)

      toast.success('Business profile created!')
      router.push('/dashboard')
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center mb-8">
          <div className="w-10 h-10 bg-[#5B6CF0] rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Set up your business</h1>
          <p className="text-gray-500 mb-6">Tell us about your business to get started.</p>

          <form onSubmit={handleSetup} className="space-y-4">
            <div>
              <Label>Business Name</Label>
              <Input
                className="mt-1.5"
                placeholder="Smith's HVAC Services"
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Industry</Label>
              <select
                className="flex h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-[#5B6CF0]"
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                required
              >
                <option value="">Select industry</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <Button type="submit" className="w-full" loading={loading}>
              Continue to Dashboard →
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
