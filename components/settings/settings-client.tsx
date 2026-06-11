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
import { CreditCard, Phone, MessageSquare, Globe, PhoneForwarded, Copy, Webhook } from 'lucide-react'

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
  const [forwardPhone, setForwardPhone] = useState(tenant.forward_to_phone || '')
  const [savingForward, setSavingForward] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showLeadCode, setShowLeadCode] = useState(false)
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

  async function saveForwardPhone() {
    setSavingForward(true)
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ forward_to_phone: forwardPhone || null })
        .eq('id', tenant.id)
      if (error) throw error
      toast.success(forwardPhone ? 'Call forwarding saved!' : 'Call forwarding disabled')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSavingForward(false)
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const bookingUrl = tenant.slug ? `${appUrl}/f/${tenant.slug}` : ''
  const intakeUrl = tenant.lead_intake_token ? `${appUrl}/api/leads/inbound/${tenant.lead_intake_token}` : ''

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied!`)).catch(() => toast.error('Copy failed'))
  }

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

      {/* Lead Sources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="w-5 h-5 text-[#4ecdc4]" />
            Lead Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-900 mb-1">Never Miss a Lead</p>
            <p className="text-sm text-blue-700">
              Every time someone requests your help — from any source — they get an automatic text within seconds. You&apos;re always first to respond.
            </p>
          </div>

          {!bookingUrl ? (
            <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
              <div className="w-2 h-2 bg-yellow-500 rounded-full flex-shrink-0" />
              <p className="text-sm text-yellow-700">Your lead sources are being set up. Refresh in a moment.</p>
            </div>
          ) : (
            <>
              {/* Personal booking link — the star */}
              <div className="rounded-xl border-2 border-[#4ecdc4]/30 bg-[#4ecdc4]/5 p-4">
                <p className="text-sm font-semibold text-gray-900">Your Personal Booking Link</p>
                <p className="text-xs text-gray-500 mt-1 mb-3">
                  Share this link anywhere. When someone clicks it and fills in their info — they get a text from you within seconds. No website, no developer, no code needed.
                </p>
                <div className="flex gap-2">
                  <code className="flex-1 min-w-0 truncate bg-white border border-gray-200 rounded-lg px-3 h-11 flex items-center text-xs sm:text-sm text-gray-700">
                    {bookingUrl}
                  </code>
                  <Button className="h-11 px-4 flex-shrink-0" onClick={() => copy(bookingUrl, 'Link')}>
                    <Copy className="w-4 h-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">Copy Link</span>
                  </Button>
                </div>
                <div className="mt-3 space-y-1.5 text-xs text-gray-600">
                  <p className="flex items-center gap-2"><span aria-hidden>📍</span> Paste it in your Google Business Profile</p>
                  <p className="flex items-center gap-2"><span aria-hidden>📱</span> Add it to your Instagram or Facebook bio</p>
                  <p className="flex items-center gap-2"><span aria-hidden>✉️</span> Include it in your email signature</p>
                </div>
              </div>

              {/* Other sources */}
              <div className="space-y-2.5">
                {/* Missed calls — already automatic */}
                <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50">
                  <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-4 h-4 text-gray-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">Missed Calls</p>
                    <p className="text-xs text-gray-500">If a call ever slips through, we automatically text them back within seconds so you never lose the job.</p>
                  </div>
                  <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium flex-shrink-0">Active</span>
                </div>
              </div>

              {/* Technical details — hidden by default */}
              <button
                onClick={() => setShowLeadCode(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 py-2 -my-1 flex items-center gap-1"
              >
                {showLeadCode ? 'Hide' : 'Show'} technical details (for developers)
              </button>

              {showLeadCode && (
                <div className="pt-1">
                  <Label className="text-sm font-medium text-gray-700">Your private intake URL</Label>
                  <p className="text-xs text-gray-400 mb-2 mt-0.5">Keep this secret. Used for Zapier/Make and custom integrations.</p>
                  <div className="flex gap-2">
                    <code className="flex-1 min-w-0 truncate bg-gray-50 border border-gray-200 rounded-lg px-3 h-11 flex items-center text-xs text-gray-700">
                      {intakeUrl}
                    </code>
                    <Button variant="outline" className="h-11 px-3 flex-shrink-0" onClick={() => copy(intakeUrl, 'URL')}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">POST <code>{`{ phone, name?, source? }`}</code> (JSON or form data).</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Call Forwarding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneForwarded className="w-5 h-5 text-[#4ecdc4]" />
            Call Forwarding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-900 mb-1">How it works</p>
            <p className="text-sm text-blue-700">
              When a customer calls your AI number, <strong>your phone rings first</strong>. If you don't pick up within 5 rings, your AI answers automatically — so no lead is ever missed.
            </p>
          </div>
          <div>
            <Label className="text-sm font-medium text-gray-700">
              Your personal or work phone number
            </Label>
            <p className="text-xs text-gray-400 mb-2 mt-0.5">Enter the number you want to ring first (your cell, office line, etc.). If you don't answer within 5 rings, your AI takes over automatically — so you never lose a lead. Leave blank to have AI answer all calls directly.</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  className="pl-9 h-11"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={forwardPhone}
                  onChange={e => setForwardPhone(e.target.value)}
                />
              </div>
              <Button onClick={saveForwardPhone} loading={savingForward} className="h-11 px-5">
                Save
              </Button>
            </div>
          </div>
          {forwardPhone && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
              <p className="text-sm text-green-700">
                Your phone <strong>{forwardPhone}</strong> rings first — AI picks up if you don't answer
              </p>
            </div>
          )}
          {!forwardPhone && (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div className="w-2 h-2 bg-gray-400 rounded-full flex-shrink-0" />
              <p className="text-sm text-gray-500">AI answers all calls directly (no forwarding set)</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <CardTitle>Billing & Subscription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Current plan banner */}
          {tenant.plan === 'trial' ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-yellow-800">Free Trial</span>
                <span className="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">
                  {tenant.trial_ends_at
                    ? `${Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))} days left`
                    : 'Active'}
                </span>
              </div>
              <p className="text-sm text-yellow-700">Upgrade before your trial ends to keep your AI running 24/7.</p>
            </div>
          ) : (
            <div className="bg-[#4ecdc4]/10 border border-[#4ecdc4]/30 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Current plan</p>
                <p className="text-lg font-bold text-gray-900 capitalize">{tenant.plan}</p>
              </div>
              <Button variant="outline" size="sm" onClick={openBillingPortal}>
                <CreditCard className="w-4 h-4 mr-1.5" />
                Manage
              </Button>
            </div>
          )}

          {/* Plans */}
          <div className="space-y-3">
            {[
              { key: 'starter', name: 'Starter', price: '$97', period: '/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID, features: ['1 AI Employee', '500 conversations/mo', 'SMS + Voice'] },
              { key: 'pro', name: 'Pro', price: '$197', period: '/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID, features: ['3 AI Employees', '2,000 conversations/mo', 'All channels'], popular: true },
              { key: 'business', name: 'Business', price: '$397', period: '/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID, features: ['Unlimited AI Employees', 'Unlimited conversations', 'Priority support'] },
            ].map(plan => {
              const isCurrent = tenant.plan === plan.key
              return (
                <div key={plan.key} className={`relative rounded-xl border-2 p-4 ${isCurrent ? 'border-[#4ecdc4] bg-[#4ecdc4]/5' : 'border-gray-100 bg-white'}`}>
                  {plan.popular && !isCurrent && (
                    <span className="absolute -top-2.5 left-4 text-xs font-semibold bg-[#1a1f36] text-white px-2.5 py-0.5 rounded-full">Most popular</span>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-gray-900">{plan.name}</p>
                        {isCurrent && <span className="text-xs font-medium text-[#4ecdc4] bg-[#4ecdc4]/10 px-2 py-0.5 rounded-full">Your plan</span>}
                      </div>
                      <p className="mt-0.5">
                        <span className="text-xl font-bold text-gray-900">{plan.price}</span>
                        <span className="text-sm text-gray-400">{plan.period}</span>
                      </p>
                    </div>
                    {!isCurrent && (
                      <button
                        onClick={() => handleUpgrade(plan.priceId!)}
                        className="h-11 px-5 text-sm font-semibold bg-[#1a1f36] text-white rounded-xl hover:bg-[#2a2f46] transition-colors flex-shrink-0"
                      >
                        Upgrade
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    {plan.features.map(f => (
                      <span key={f} className="text-xs text-gray-500">✓ {f}</span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {tenant.plan !== 'trial' && (
            <button onClick={openBillingPortal} className="w-full text-xs text-gray-400 hover:text-gray-600 py-3.5 -my-2.5 flex items-center justify-center gap-1">
              <CreditCard className="w-3.5 h-3.5" /> Manage billing & invoices
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
