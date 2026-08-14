'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Tenant } from '@/types'

// The settings screen's behaviour, moved here VERBATIM from settings-client.tsx: the billing portal,
// the checkout handler and its `upgrading` state, the booking URL and the clipboard helper.
//
// Same lift as useTestAi and useAgentEditor, and for the same reason — /v2 needs the identical
// handlers, and a second copy of a checkout call is a second thing to keep in step with Stripe.

export function useSettings(tenant: Tenant) {
  async function openBillingPortal() {
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url } = await res.json()
    if (url) window.open(url, '_blank')
  }

  const [upgrading, setUpgrading] = useState<string | null>(null)
  async function handleUpgrade(plan: string) {
    if (upgrading) return
    setUpgrading(plan)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) { window.location.assign(data.url); return }
      toast.error(data.error || 'Could not start checkout. Please try again.')
    } catch {
      toast.error('Could not reach billing. Check your connection and try again.')
    } finally {
      setUpgrading(null)
    }
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

  return { openBillingPortal, upgrading, handleUpgrade, appUrl, bookingUrl, copy }
}
