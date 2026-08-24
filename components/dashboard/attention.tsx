'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useClientMounted } from '@/lib/use-client-mounted'
import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import { NeedsYou } from '@/components/dashboard/hero/needs-you'
import { attentionStore, type AttentionItem, type AttentionSnapshot } from '@/lib/dashboard/attention-store'

// The one hook every surface reads. Instant, tear-free updates via useSyncExternalStore.
export function useAttention(): AttentionSnapshot {
  return useSyncExternalStore(attentionStore.subscribe, attentionStore.getSnapshot, attentionStore.getServerSnapshot)
}

/**
 * Binds the tenant + seeds the server-computed active issues into the store (instant, no flash).
 * Mount once on the dashboard. The notification bell also binds the tenant globally, so the count
 * is correct on every page — this just gives the dashboard the freshest data with zero flicker.
 */
export function AttentionSync({ tenantId, items, waiting = 0 }: { tenantId: string; items: AttentionItem[]; waiting?: number }) {
  useEffect(() => {
    attentionStore.setTenant(tenantId)
    attentionStore.seed(items, waiting)
    // Re-seed when the server-rendered items change (navigation / refresh).
  }, [tenantId, JSON.stringify(items), waiting])
  return null
}

const phrase = (n: number) => `${n} ${n === 1 ? 'thing needs' : 'things need'} your attention.`

/** The reactive dashboard sentence. Before hydration it shows the server value (no flash). */
export function AttentionSentence({ initial, idleSentence }: { initial: string; idleSentence: string }) {
  const { ready, unresolvedCount } = useAttention()
  if (!ready) return <>{initial}</>
  return <>{unresolvedCount > 0 ? phrase(unresolvedCount) : idleSentence}</>
}

/**
 * The mobile attention pill — shows only while there are unresolved notifications.
 *
 * IT USED TO BE AN ANCHOR TO #attention-needed, and that anchor pointed at a banner below the hero.
 * The banner is gone: the list lives in the hero's right column now, and on a phone there is no
 * right column. So the pill opens the list itself, in a drawer, in the kit's language — the same
 * component the column renders, reading the same store, with the same dismiss.
 *
 * Amber and rounded-xl went with the banner. This is the kit's notice row: the badge carries the
 * urgency and the sentence carries the fact.
 */
export function AttentionPill({ initialVisible }: { initialVisible: boolean }) {
  const { ready, unresolvedCount } = useAttention()
  const [open, setOpen] = useState(false)
  // createPortal needs a DOM; this component renders on the server first.
  const mounted = useClientMounted()
  const show = ready ? unresolvedCount > 0 : initialVisible
  if (!show) return null
  return (
    <div className="v2 md:hidden">
      <button type="button" onClick={() => setOpen(true)}
              className="v2-notice mb-4 w-full text-left" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
        <span className="v2-chip-sq"><AlertTriangle /></span>
        <p><AttentionSentence initial={phrase(1)} idleSentence="" /></p>
        <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--v2-ink-45)' }} />
      </button>

      {/* PORTALLED TO <body>, and this is not tidiness — it is the only thing that makes it work.
          The pill lives in a section carrying sx-animate-in, and a transform on an ancestor becomes
          the containing block for `position: fixed` descendants. Rendered in place, the drawer's
          "fixed inset-0" resolved against that section: measured [0, 56, 390, 844], so the drawer
          hung 56px below the screen and its last row sat under the swipe handle. Nothing about the
          CSS was wrong; the tree was. */}
      {open && mounted && createPortal(
        /* z-60: the navigation host is 55, and a drawer the page opened must sit over the app's
           own chrome rather than under it. */
        <div className="v2 fixed inset-0 z-[60]">
          <div className="v2-veil" onClick={() => setOpen(false)} aria-hidden />
          <div className="v2-drawer" role="dialog" aria-modal="true" aria-label="Needs you">
            <section className="flex items-center justify-between" style={{ paddingTop: 14, paddingBottom: 14 }}>
              <p className="v2-kick" data-tone="warn"><i />Needs you{unresolvedCount > 0 ? ` · ${unresolvedCount}` : ''}</p>
              <button onClick={() => setOpen(false)} className="v2-ico" aria-label="Close"><X /></button>
            </section>
            {/* The list's own label is suppressed — the header above is it. The bottom padding
                clears the swipe handle, which is drawn over everything at z-55 and would otherwise
                sit on the last row. */}
            <section style={{ paddingBottom: 'calc(18px + var(--v2-grab-h))' }}>
              <NeedsYou fallback={[]} hideLabel />
            </section>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
