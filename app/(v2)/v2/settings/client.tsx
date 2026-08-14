'use client'

import Link from 'next/link'
import { PhoneMissed, Link2, CreditCard, Receipt } from 'lucide-react'
import type { Tenant, Channel } from '@/types'
import { useSettings } from '@/components/settings/use-settings'
import { StatusPill } from '../controls'
import { usePressState } from '../use-press'

// PURE RENDERING over useSettings — the same handlers the real settings screen calls. Nothing here
// holds state, fetches, or decides what a change means.

export function SettingsClient({ tenant, channels, hideBilling = false }: {
  tenant: Tenant; channels: Channel[]; hideBilling?: boolean
}) {
  usePressState()
  const { openBillingPortal, upgrading, handleUpgrade, bookingUrl, copy } = useSettings(tenant)

  // Missed-call capture is on when a connected voice or SMS line exists — read from the channels the
  // page already loaded, never asserted.
  const line = channels.find((c) => ['voice', 'sms'].includes(c.type) && c.status === 'connected')
  const onTrial = tenant.plan === 'trial'
  const planLabel = onTrial ? 'the free trial' : tenant.plan

  return (
    <div className="v2-page">
      <header className="v2-phd">
        <Link href="/v2" className="v2-bk" aria-label="Home">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </Link>
        <h2>Settings</h2>
      </header>

      <div className="v2-pbody" data-scroll>
        <p className="v2-lin">
          <span>Your account — the parts every AI employee shares. </span>
          {line
            ? <span>Missed calls are being caught.</span>
            : <b>No line is connected, so missed calls go nowhere.</b>}
        </p>

        <div className="v2-stagger">
          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
            <p className="v2-ghead"><i />Never miss a lead<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static>
                <span className="v2-gchip"><PhoneMissed /></span>
                <span className="v2-glab">
                  {line?.twilio_number
                    ? `A missed call to ${line.twilio_number} becomes a lead, and Rudi texts back.`
                    : 'Connect a line and every missed call becomes a lead instead of a lost customer.'}
                </span>
                <span className="v2-gtrail">
                  <StatusPill state={line ? 'live' : 'off'}>{line ? 'Active' : 'Not connected'}</StatusPill>
                </span>
              </div>
            </div>
          </section>

          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
            <p className="v2-ghead"><i />Your booking link<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static>
                <span className="v2-gchip"><Link2 /></span>
                <span className="v2-glab">{bookingUrl || 'Set a business name to get your link.'}</span>
                {bookingUrl && (
                  <span className="v2-gtrail">
                    <button type="button" data-touch className="v2-ract"
                      onClick={() => copy(bookingUrl, 'Booking link')}>Copy</button>
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* ABSENT in operator mode, not disabled: a White Label client's plan is the partner's, and
              a greyed-out upgrade would describe a thing they cannot do here. */}
          {!hideBilling && (
            <>
              <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
                <p className="v2-ghead"><i />Plan<s /></p>
                <div className="v2-gcard">
                  <div className="v2-grow" data-static>
                    <span className="v2-gchip"><CreditCard /></span>
                    <span className="v2-glab">You are on {planLabel}.</span>
                    <span className="v2-gtrail">
                      <StatusPill state={onTrial ? 'pending' : 'live'}>{onTrial ? 'Trial' : 'Active'}</StatusPill>
                    </span>
                  </div>
                  {onTrial && (
                    <div className="v2-grow">
                      <span className="v2-glab">Upgrade to keep Rudi answering after the trial.</span>
                      <span className="v2-gtrail">
                        <button type="button" data-touch className="v2-ract" data-tone="primary"
                          disabled={!!upgrading} onClick={() => handleUpgrade('pro')}>
                          {upgrading ? 'Opening…' : 'Upgrade'}
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              </section>

              <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
                <p className="v2-ghead"><i />Billing<s /></p>
                <div className="v2-gcard">
                  <div className="v2-grow" data-static>
                    <span className="v2-gchip"><Receipt /></span>
                    <span className="v2-glab">Invoices, card details and cancellation live with Stripe.</span>
                    <span className="v2-gtrail">
                      <button type="button" data-touch className="v2-ract" onClick={openBillingPortal}>Open portal</button>
                    </span>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
