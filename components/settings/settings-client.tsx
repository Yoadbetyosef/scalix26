'use client'

import { useState, useEffect } from 'react'
import { Tenant, Channel } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { CreditCard, Phone, MessageSquare, Globe, Copy, Webhook, MapPin, Smartphone, Mail, Check } from 'lucide-react'

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  voice: Phone,
  sms: MessageSquare,
  whatsapp: MessageSquare,
  instagram: Globe,
  facebook: Globe,
}

// Apple-style channel colors — the icon tile carries the channel identity.
const CHANNEL_TONE: Record<string, string> = {
  voice: 'bg-cyan-500', sms: 'bg-emerald-500', whatsapp: 'bg-green-500',
  instagram: 'bg-pink-500', facebook: 'bg-blue-600', email: 'bg-violet-500',
}

interface Props {
  tenant: Tenant
  channels: Channel[]
  // Operator mode (a White Label partner operating a client): hide the Scalix billing/subscription
  // section entirely — a client's plan is governed by the partner, never Scalix Stripe.
  hideBilling?: boolean
}

export function SettingsClient({ tenant, channels, hideBilling = false }: Props) {

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

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied!`)).catch(() => toast.error('Copy failed'))
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-ink">Settings</h1>
        <p className="text-sm text-muted mt-1">Manage your business profile and integrations</p>
      </div>

      {/* Business identity AND availability & reviews are now edited on the AI
          Employee page — the single source of truth — not duplicated here. */}

      {/* Connected Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-indigo-500 text-white shadow-e1"><MessageSquare className="h-[18px] w-[18px]" strokeWidth={2} /></span>
            Connected Channels
          </CardTitle>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-subtle">No channels connected yet. Create an AI employee to add channels.</p>
          ) : (
            <div className="space-y-3">
              {channels.map(ch => {
                const Icon = CHANNEL_ICONS[ch.type] || MessageSquare
                return (
                  <div key={ch.id} className="flex items-center gap-3 p-3 rounded-xl bg-sunken">
                    <div className={`w-8 h-8 rounded-lg ${CHANNEL_TONE[ch.type] || 'bg-slate-500'} flex items-center justify-center text-white shadow-e1`}>
                      <Icon className="w-4 h-4" strokeWidth={2} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-ink capitalize">{ch.type}</p>
                      {ch.twilio_number && <p className="text-xs text-subtle">{ch.twilio_number}</p>}
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
          <CardTitle className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-orange-500 text-white shadow-e1"><Webhook className="h-[18px] w-[18px]" strokeWidth={2} /></span>
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
              <div className="rounded-2xl border border-accent/25 bg-accent/[0.06] p-5">
                <p className="text-sm font-medium text-ink">Your Personal Booking Link</p>
                <p className="text-xs text-subtle mt-1 mb-3">
                  Share this link anywhere. When someone clicks it and fills in their info — they get a text from you within seconds. No website, no developer, no code needed.
                </p>
                <div className="flex gap-2">
                  <code className="flex-1 min-w-0 truncate bg-white border border-hairline rounded-lg px-3 h-11 flex items-center text-xs sm:text-sm text-ink">
                    {bookingUrl}
                  </code>
                  <Button className="h-11 px-4 flex-shrink-0" onClick={() => copy(bookingUrl, 'Link')}>
                    <Copy className="w-4 h-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">Copy Link</span>
                  </Button>
                </div>
                <div className="mt-3 space-y-1.5 text-xs text-subtle">
                  <p className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-muted" /> Paste it in your Google Business Profile</p>
                  <p className="flex items-center gap-2"><Smartphone className="w-3.5 h-3.5 text-muted" /> Add it to your Instagram or Facebook bio</p>
                  <p className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-muted" /> Include it in your email signature</p>
                </div>
              </div>

              {/* Other sources */}
              <div className="space-y-2.5">
                {/* Missed calls — already automatic */}
                <div className="flex items-center gap-3 p-3 rounded-lg border border-hairline bg-sunken">
                  <div className="w-9 h-9 rounded-lg bg-cyan-500 flex items-center justify-center text-white shadow-e1 flex-shrink-0">
                    <Phone className="w-4 h-4" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink">Missed Calls</p>
                    <p className="text-xs text-subtle">If a call ever slips through, we automatically text them back within seconds so you never lose the job.</p>
                  </div>
                  <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium flex-shrink-0">Active</span>
                </div>
              </div>

              {/* The private intake URL (/api/leads/inbound, for Zapier/Make) is hidden
                  from the UI — the route stays live; we may re-expose it for advanced users. */}
            </>
          )}
        </CardContent>
      </Card>

      {/* Billing — hidden in operator mode (a White Label client never sees Scalix billing). */}
      {!hideBilling && (
      <Card id="billing" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-600 text-white shadow-e1"><CreditCard className="h-[18px] w-[18px]" strokeWidth={2} /></span>
            Billing & Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Current plan banner */}
          {tenant.plan === 'trial' ? (
            (() => {
              const trialDaysLeft = tenant.trial_ends_at
                ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))
                : null
              const ended = trialDaysLeft === 0
              return (
                <div className={`border rounded-xl p-4 ${ended ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-bold ${ended ? 'text-red-800' : 'text-yellow-800'}`}>Free Trial</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ended ? 'bg-red-200 text-red-800' : 'bg-yellow-200 text-yellow-800'}`}>
                      {trialDaysLeft !== null ? `${trialDaysLeft} days left` : 'Active'}
                    </span>
                  </div>
                  <p className={`text-sm ${ended ? 'text-red-700' : 'text-yellow-700'}`}>
                    {ended
                      ? 'Trial ended — upgrade to keep your AI running 24/7'
                      : 'Upgrade before your trial ends to keep your AI running 24/7.'}
                  </p>
                </div>
              )
            })()
          ) : (
            <div className="bg-accent/[0.08] border border-accent/20 rounded-2xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-subtle mb-0.5">Current plan</p>
                <p className="text-lg font-semibold text-ink capitalize">{tenant.plan}</p>
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
                <div key={plan.key} className={`relative rounded-2xl border p-5 transition-all ${isCurrent ? 'border-accent/40 bg-accent/5 shadow-e1' : 'border-hairline bg-white hover:shadow-e2'}`}>
                  {plan.popular && !isCurrent && (
                    <span className="absolute -top-2.5 left-4 text-xs font-medium bg-ink text-white px-2.5 py-0.5 rounded-full">Most popular</span>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-ink">{plan.name}</p>
                        {isCurrent && <span className="text-xs font-medium text-accent-strong bg-accent/10 px-2 py-0.5 rounded-full">Your plan</span>}
                      </div>
                      <p className="mt-0.5">
                        <span className="text-xl font-semibold text-ink">{plan.price}</span>
                        <span className="text-sm text-muted">{plan.period}</span>
                      </p>
                    </div>
                    {!isCurrent && (
                      <button
                        onClick={() => handleUpgrade(plan.priceId!)}
                        className="h-11 px-5 text-sm font-medium bg-ink text-white rounded-button shadow-e1 hover:bg-ink/90 hover:shadow-e2 transition-all flex-shrink-0"
                      >
                        Upgrade
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    {plan.features.map(f => (
                      <span key={f} className="text-xs text-subtle flex items-center gap-1"><Check className="w-3 h-3 text-green-500" /> {f}</span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {tenant.plan !== 'trial' && (
            <button onClick={openBillingPortal} className="w-full text-xs text-muted hover:text-subtle py-3.5 -my-2.5 flex items-center justify-center gap-1">
              <CreditCard className="w-3.5 h-3.5" /> Manage billing & invoices
            </button>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  )
}
