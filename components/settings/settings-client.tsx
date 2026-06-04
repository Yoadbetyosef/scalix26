'use client'

import { useState } from 'react'
import { Tenant, Channel } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ExternalLink, CreditCard, Phone, MessageSquare, Globe } from 'lucide-react'

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  voice: Phone,
  sms: MessageSquare,
  whatsapp: MessageSquare,
  instagram: Globe,
  facebook: Globe,
}

interface Props {
  tenant: Tenant
  channels: Channel[]
}

export function SettingsClient({ tenant, channels }: Props) {
  const [form, setForm] = useState({
    business_name: tenant.business_name || '',
    phone: tenant.phone || '',
    email: tenant.email || '',
    website: tenant.website || '',
    address: tenant.address || '',
    city: tenant.city || '',
    state: tenant.state || '',
  })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await supabase.from('tenants').update(form).eq('id', tenant.id)
      if (error) throw error
      toast.success('Settings saved!')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function openBillingPortal() {
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url } = await res.json()
    if (url) window.open(url, '_blank')
  }

  async function handleUpgrade(priceId: string) {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId }),
    })
    const { url } = await res.json()
    if (url) window.location.href = url
  }

  const planColors = { trial: 'bg-yellow-50 text-yellow-700', starter: 'bg-blue-50 text-blue-700', pro: 'bg-purple-50 text-purple-700', business: 'bg-green-50 text-green-700' }

  return (
    <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your business profile and integrations</p>
      </div>

      {/* Business Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Business Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Business Name</Label>
              <Input className="mt-1.5" value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input className="mt-1.5" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>Email</Label>
              <Input className="mt-1.5" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Website</Label>
              <Input className="mt-1.5" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Address</Label>
              <Input className="mt-1.5" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <Label>City</Label>
              <Input className="mt-1.5" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div>
              <Label>State</Label>
              <Input className="mt-1.5" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
            </div>
          </div>
          <Button onClick={handleSave} loading={saving}>Save Changes</Button>
        </CardContent>
      </Card>

      {/* Connected Channels */}
      <Card>
        <CardHeader>
          <CardTitle>Connected Channels</CardTitle>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-gray-500">No channels connected yet. Create an AI employee to add channels.</p>
          ) : (
            <div className="space-y-3">
              {channels.map(ch => {
                const Icon = CHANNEL_ICONS[ch.type] || MessageSquare
                return (
                  <div key={ch.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                    <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-gray-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 capitalize">{ch.type}</p>
                      {ch.twilio_number && <p className="text-xs text-gray-500">{ch.twilio_number}</p>}
                    </div>
                    <Badge variant={ch.status as 'connected' | 'disconnected' | 'pending'}>{ch.status}</Badge>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <CardTitle>Billing & Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Current Plan</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-sm font-semibold px-2.5 py-1 rounded-full capitalize ${planColors[tenant.plan as keyof typeof planColors] || 'bg-gray-100 text-gray-700'}`}>
                  {tenant.plan}
                </span>
                {tenant.trial_ends_at && tenant.plan === 'trial' && (
                  <span className="text-xs text-gray-500">
                    Trial ends {new Date(tenant.trial_ends_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <Button variant="outline" onClick={openBillingPortal} className="w-full sm:w-auto">
              <CreditCard className="w-4 h-4 mr-2" />
              Manage Billing
              <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>

          {/* Plans */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            {[
              { key: 'starter', name: 'Starter', price: '$97/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID, features: ['1 AI Employee', '500 conversations', 'SMS + Voice'] },
              { key: 'pro', name: 'Pro', price: '$197/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID, features: ['3 AI Employees', '2,000 conversations', 'All channels'] },
              { key: 'business', name: 'Business', price: '$397/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID, features: ['Unlimited', 'Unlimited conversations', 'Priority support'] },
            ].map(plan => (
              <div key={plan.name} className={`p-4 rounded-xl border-2 ${tenant.plan === plan.key ? 'border-[#4ecdc4] bg-[#4ecdc4]/5' : 'border-gray-100'}`}>
                <p className="font-semibold text-gray-900">{plan.name}</p>
                <p className="text-lg font-bold text-[#4ecdc4] mt-0.5">{plan.price}</p>
                <ul className="mt-2 space-y-1 mb-3">
                  {plan.features.map(f => <li key={f} className="text-xs text-gray-500">• {f}</li>)}
                </ul>
                {tenant.plan === plan.key ? (
                  <span className="text-xs font-medium text-[#4ecdc4]">Current plan</span>
                ) : (
                  <button
                    onClick={() => handleUpgrade(plan.priceId!)}
                    className="w-full mt-1 px-3 py-1.5 text-xs font-medium bg-[#1a1f36] text-white rounded-lg hover:bg-[#2a2f46] transition-colors"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
