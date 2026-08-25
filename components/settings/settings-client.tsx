'use client'

import { useState, useEffect } from 'react'
import { Tenant, Channel } from '@/types'
import { useSettings } from './use-settings'
import { CreditCard, Phone, MessageSquare, Globe, Copy, Webhook, MapPin, Smartphone, Mail, Zap } from 'lucide-react'
import { StatusPill } from '@/app/(v2)/v2/controls'
import { channelHue, channelKey, CHANNEL_LABEL } from '@/app/(v2)/v2/channels'

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  voice: Phone,
  sms: MessageSquare,
  whatsapp: MessageSquare,
  instagram: Globe,
  facebook: Globe,
}

// The hue comes from channelHue — the same value the chips, the table rows and the analytics bars
// use. v1 kept a second map of Tailwind backgrounds here, which is how "whatsapp" ended up green in
// one place and emerald in another.

interface Props {
  tenant: Tenant
  channels: Channel[]
  // Operator mode (a White Label partner operating a client): hide the Scalix billing/subscription
  // section entirely — a client's plan is governed by the partner, never Scalix Stripe.
  hideBilling?: boolean
}

export function SettingsClient({ tenant, channels, hideBilling = false }: Props) {

  // Moved to use-settings.ts so /v2's settings screen drives the SAME handlers — see that header.
  const { openBillingPortal, upgrading, handleUpgrade, bookingUrl, copy } = useSettings(tenant)

  return (
    <div className="v2 v2-embedded p-4 sm:p-6 max-w-3xl max-md:pb-16">
      {/* No page title: the rail says Settings. Business identity and availability & reviews are
          edited on the AI Employee page — the single source of truth — not duplicated here. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Your business profile and integrations</p>
        <s />
      </div>

      <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
        <p className="v2-ghead"><i />Connected channels<s /></p>
        <div className="v2-gcard">
          {channels.length === 0 ? (
            <div className="v2-grow" data-static>
              <span className="v2-gchip"><MessageSquare /></span>
              <span className="v2-glab">No channels connected yet. Create an AI employee to add channels.</span>
            </div>
          ) : channels.map(ch => {
            const Icon = CHANNEL_ICONS[ch.type] || MessageSquare
            return (
              <div key={ch.id} className="v2-grow" data-static style={{ ['--ghue' as string]: channelHue(ch.type) }}>
                <span className="v2-gchip"><Icon /></span>
                <span className="v2-glab">
                  {/* CHANNEL_LABEL, not capitalize — the raw type title-cased renders "Sms", and
                      the app spells it SMS everywhere else. */}
                  <b style={{ fontWeight: 550 }}>{CHANNEL_LABEL[channelKey(ch.type) as keyof typeof CHANNEL_LABEL] ?? ch.type}</b>
                  {ch.twilio_number && <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>{ch.twilio_number}</span>}
                </span>
                <span className="v2-gtrail">
                  <StatusPill state={ch.status === 'connected' ? 'live' : ch.status === 'pending' ? 'pending' : 'off'}>{ch.status}</StatusPill>
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
        <p className="v2-ghead"><i />Lead sources<s /></p>
        <div className="v2-gcard">
          <div className="v2-grow" data-static>
            <span className="v2-gchip"><Webhook /></span>
            <span className="v2-glab">
              <b style={{ fontWeight: 550 }}>Never miss a lead</b>
              <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
                Every time someone requests your help — from any source — they get an automatic text
                within seconds. You are always first to respond.
              </span>
            </span>
          </div>

          {!bookingUrl ? (
            <div className="v2-grow" data-static style={{ ['--ghue' as string]: 'var(--v2-amber)' }}>
              <span className="v2-gchip"><Zap /></span>
              <span className="v2-glab">Your lead sources are being set up. Refresh in a moment.</span>
            </div>
          ) : (
            <>
              {/* THE BOOKING LINK is the one thing on this screen a person came to copy, so it is a
                  field with its verb beside it rather than a tinted panel with a heading. */}
              <div className="v2-field">
                <span className="v2-flab">Your personal booking link</span>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                  <input className="v2-finput" readOnly value={bookingUrl} style={{ fontFamily: 'var(--v2-mono)', fontSize: 13 }} aria-label="Your personal booking link" />
                  <button onClick={() => copy(bookingUrl, 'Link')} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)', marginBottom: 6 }}>
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </div>
                <em className="v2-fhint">
                  Share it anywhere. When someone clicks it and fills in their details they get a text
                  from you within seconds — no website, no developer, no code.
                </em>
                {/* Where to put it. Three places, as three facts rather than three icon lines. */}
                <dl className="v2-facts" data-narrow style={{ marginTop: 14 }}>
                  <div><dt><MapPin className="w-3.5 h-3.5" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Google</dt><dd>In your Business Profile</dd></div>
                  <div><dt><Smartphone className="w-3.5 h-3.5" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Social</dt><dd>In your Instagram or Facebook bio</dd></div>
                  <div><dt><Mail className="w-3.5 h-3.5" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Email</dt><dd>In your signature</dd></div>
                </dl>
              </div>

              <div className="v2-grow" data-static style={{ ['--ghue' as string]: channelHue('voice') }}>
                <span className="v2-gchip"><Phone /></span>
                <span className="v2-glab">
                  <b style={{ fontWeight: 550 }}>Missed calls</b>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
                    If a call ever slips through, we text them back within seconds so you never lose the job.
                  </span>
                </span>
                <span className="v2-gtrail"><StatusPill state="live">Active</StatusPill></span>
              </div>

              {/* The private intake URL (/api/leads/inbound, for Zapier/Make) is hidden
                  from the UI — the route stays live; we may re-expose it for advanced users. */}
            </>
          )}
        </div>
      </section>

      {/* BILLING — hidden in operator mode (a White Label client never sees Scalix billing).
          RESKIN ONLY. Every handler, plan key, price, feature line and disabled condition below is
          byte-for-byte what it was; openBillingPortal and handleUpgrade come from use-settings
          untouched, and the id="billing" anchor stays because the rail and the trial widget both
          deep-link to it. */}
      {!hideBilling && (
      <section className="v2-group" id="billing" style={{ ['--ghue' as string]: 'var(--v2-t4)', scrollMarginTop: 24 }}>
        <p className="v2-ghead"><i />Billing &amp; subscription<s /></p>
        <div className="v2-gcard">

          {/* Current plan */}
          {tenant.plan === 'trial' ? (
            (() => {
              const trialDaysLeft = tenant.trial_ends_at
                ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))
                : null
              const ended = trialDaysLeft === 0
              return (
                <div className="v2-grow" data-static style={{ ['--ghue' as string]: ended ? 'var(--v2-red)' : 'var(--v2-amber)' }}>
                  <span className="v2-gchip"><CreditCard /></span>
                  <span className="v2-glab">
                    <b style={{ fontWeight: 550 }}>Free trial</b>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
                      {ended
                        ? 'Trial ended — upgrade to keep your AI running 24/7.'
                        : 'Upgrade before your trial ends to keep your AI running 24/7.'}
                    </span>
                  </span>
                  <span className="v2-gtrail">
                    <StatusPill state={ended ? 'off' : 'pending'}>
                      {trialDaysLeft !== null ? `${trialDaysLeft} days left` : 'Active'}
                    </StatusPill>
                  </span>
                </div>
              )
            })()
          ) : (
            <div className="v2-grow" data-static>
              <span className="v2-gchip"><CreditCard /></span>
              <span className="v2-glab">
                <b style={{ fontWeight: 550, textTransform: 'capitalize' }}>{tenant.plan}</b>
                <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>Your current plan</span>
              </span>
              <span className="v2-gtrail">
                <button onClick={openBillingPortal} className="v2-act tap-target">
                  <CreditCard className="w-3.5 h-3.5" /> Manage
                </button>
              </span>
            </div>
          )}

          {/* THE THREE PLANS. v1 gave each its own bordered card with a floating "Most popular" tab,
              inside a card, inside a page — and the tab overlapped the border above it. They are three
              rows: the name, what it costs, what it includes, and the one verb that acts on it. The
              plan you are on is marked rather than boxed. */}
          {[
            { key: 'starter', name: 'Starter', price: '$297', period: '/mo', features: ['1 AI Employee', '500 conversations/mo', 'SMS + Voice'] },
            { key: 'pro', name: 'Pro', price: '$397', period: '/mo', features: ['3 AI Employees', '2,000 conversations/mo', 'All channels'], popular: true },
            { key: 'business', name: 'Business', price: '$597', period: '/mo', features: ['Unlimited AI Employees', 'Unlimited conversations', 'Priority support'] },
          ].map(plan => {
            const isCurrent = tenant.plan === plan.key
            return (
              <div key={plan.key} className="v2-grow" data-static style={isCurrent ? { ['--ghue' as string]: 'var(--v2-t4)' } : undefined}>
                <span className="v2-gchip"><Zap /></span>
                <span className="v2-glab">
                  <span style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                    <b style={{ fontWeight: 550 }}>{plan.name}</b>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--v2-ink)', fontVariantNumeric: 'tabular-nums' }}>{plan.price}</span>
                    <span className="v2-kick" style={{ marginBottom: 0 }}>{plan.period}</span>
                    {isCurrent && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>Your plan</span>}
                    {plan.popular && !isCurrent && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t1)' }}>Most popular</span>}
                  </span>
                  <span style={{ display: 'block', marginTop: 4, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
                    {plan.features.join(' · ')}
                  </span>
                </span>
                {!isCurrent && (
                  <span className="v2-gtrail">
                    <button
                      onClick={() => handleUpgrade(plan.key)}
                      disabled={upgrading !== null}
                      className="v2-act tap-target"
                      data-solid
                      style={{ ['--ghue' as string]: 'var(--v2-t4)' }}
                    >
                      {upgrading === plan.key ? 'Starting…' : 'Upgrade'}
                    </button>
                  </span>
                )}
              </div>
            )
          })}

          {tenant.plan !== 'trial' && (
            <div className="v2-bar" style={{ padding: '0 12px 12px' }}>
              <button onClick={openBillingPortal} className="v2-act tap-target">
                <CreditCard className="w-3.5 h-3.5" /> Manage billing &amp; invoices
              </button>
            </div>
          )}
        </div>
      </section>
      )}
    </div>
  )
}
