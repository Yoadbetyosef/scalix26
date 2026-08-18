'use client'

import { useState } from 'react'
import { categoryLabel } from '@/lib/expenses/categories'
import type { ExpenseRow } from '@/lib/expenses/store'
import { ExpenseSheet } from './sheet'

// ONE ROW, AND THE WAY BACK INTO IT.
//
// The row is the edit affordance — there is no pencil at the end of it. A list where every row also
// carries an icon meaning "this row" is a list that spends a column saying what the row already is,
// and on a phone that column is competing with the amount for the space that matters.
//
// ── THE RECEIPT LINK IS NOT INSIDE THE BUTTON ───────────────────────────────────────────────────
//
// An <a> inside a <button> is invalid markup and behaves differently in every browser that renders it
// anyway. So the tappable part is a button covering the name and the amount, and the receipt stays a
// sibling — which is also the right split by meaning: opening the photo and correcting the row are
// two different intentions, and the photo is the one people tap by accident when it is inside.

export function Row({ e, showsTax }: { e: ExpenseRow; showsTax: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="v2-xrw">
      <button type="button" className="v2-xopen" onClick={() => setOpen(true)} aria-label={`Edit ${e.merchant}`}>
        <span className="v2-xmid">
          <span className="v2-xnm">{e.merchant}</span>
          <span className="v2-xmeta">
            {[categoryLabel(e.category), day(e.spentOn), e.note].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="v2-xamt">
          <span className="v2-xval">{money(e.amountCents, e.currency)}</span>
          {/* Only where it means something. A net figure on a US row would be the same number twice. */}
          {showsTax && e.taxCents !== null && (
            <span className="v2-xnet">{money(e.amountCents - e.taxCents, e.currency)} net</span>
          )}
        </span>
      </button>

      {/* A link when there is one, a marker when there is not — same slot either way, so the column
          reads as a column rather than as ragged optional decoration. */}
      {e.hasReceipt ? (
        <a className="v2-xrec" href={`/api/expenses/${e.id}/receipt`} target="_blank" rel="noreferrer" aria-label={`Receipt for ${e.merchant}`}>
          <Paper />
        </a>
      ) : (
        <span className="v2-xrec" data-none aria-label="No receipt">—</span>
      )}

      {open && <ExpenseSheet showsTax={showsTax} expense={e} onClose={() => setOpen(false)} />}
    </div>
  )
}

const money = (cents: number, currency: string) => {
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''
  return `${sym}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()

const Paper = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 3v5h5" /><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2z" />
  </svg>
)
