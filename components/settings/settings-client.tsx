'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Tenant, Channel } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { CreditCard, Phone, MessageSquare, Globe, Copy, Webhook, Calendar, MapPin, Smartphone, Mail, Check } from 'lucide-react'

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
  const [showLeadCode, setShowLeadCode] = useState(false)

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

  // Use the brand domain the user is actually on (app.scalix26.com vs
  // app.mylocksmithai.com) so shared links never leak the wrong brand. Initialized
  // to the env value to avoid an SSR/hydration mismatch, then set to the real origin.
  const [appUrl, setAppUrl] = useState(process.env.NEXT_PUBLIC_APP_URL || '')
  useEffect(() => { setAppUrl(window.location.origin) }, [])
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

      {/* Availability & Reviews link */}
      <Link href="/settings/availability" className="tap-target block">
        <Card className="hover:border-[#4ecdc4] transition-colors">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="font-semibold text-gray-900 flex items-center gap-2"><Calendar className="w-4 h-4 text-[#4ecdc4]" /> Availability &amp; Reviews</p>
              <p className="text-sm text-gray-500 mt-0.5">Set appointment times and Google review automation</p>
            </div>
            <span className="text-gray-300 text-xl">›</span>
          </CardContent>
        </Card>
      </Link>

      {/* Business identity (name, email, address, hours, etc.) is edited on the
          AI Employee page — the single source of truth — not duplicated here. */}

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
                  <p className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-gray-400" /> Paste it in your Google Business Profile</p>
                  <p className="flex items-center gap-2"><Smartphone className="w-3.5 h-3.5 text-gray-400" /> Add it to your Instagram or Facebook bio</p>
                  <p className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-gray-400" /> Include it in your email signature</p>
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

      {/* Billing */}
      <Card id="billing" className="scroll-mt-6">
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
              { key: 'starter', name: 'Starter', price: '$297', period: '/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID, features: ['1 AI Employee', '500 conversations/mo', 'SMS + Voice'] },
              { key: 'pro', name: 'Pro', price: '$397', period: '/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID, features: ['3 AI Employees', '2,000 conversations/mo', 'All channels'], popular: true },
              { key: 'business', name: 'Business', price: '$597', period: '/mo', priceId: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID, features: ['Unlimited AI Employees', 'Unlimited conversations', 'Priority support'] },
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
                      <span key={f} className="text-xs text-gray-500 flex items-center gap-1"><Check className="w-3 h-3 text-green-500" /> {f}</span>
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
