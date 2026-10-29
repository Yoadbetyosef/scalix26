'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../../form-sheet'
import { Send } from '../glyphs'
import { InvoicePaper } from '@/components/invoices/invoice-paper'
import type { PublicInvoice } from '@/lib/core/invoice-read'

// SENDING AN INVOICE TO THE PERSON WHO OWES THE MONEY.
//
// It gets a sheet rather than one press, because there IS a second answer: which address it goes to,
// and by which channel. A one-press send would use whatever is on the contact record without showing
// it, and the first time somebody notices is when the money does not arrive.
//
// ── THE SHEET SHOWS THE PAPER ───────────────────────────────────────────────────────────────────
//
// Below the address is the customer's copy itself — the same <InvoicePaper> /i/ renders, not a
// lookalike — so "what will they see?" is answered before the button, not after. Comments typed in the
// sheet appear on it as they are typed.
//
// ── A DRAFT IS ISSUED BY THE SAME PRESS ─────────────────────────────────────────────────────────
//
// On a draft the button says "Issue & send": it saves the comments, issues (date, due date and payment
// details stamped; total frozen), then sends. The route still refuses to send a draft — issuing is
// the step that makes there be something to send, and the button names both so nobody is surprised
// that the invoice can no longer be edited afterwards. Comments and sales tax are editable only here,
// while it is a draft: the copy a customer has never changes.
//
// ── RESEND SAYS WHEN IT LAST WENT ───────────────────────────────────────────────────────────────
//
// `sent_at` is the MOST RECENT send, so the sheet says "last sent 3 days ago" rather than implying it
// has only ever gone once. The full record is in HISTORY, which gets a row for every send.

export function SendInvoice({
  invoiceId, number, who, email, phone, sentAt, sentChannel, isDraft, paper, taxLabel, primary,
}: {
  invoiceId: string
  number: string
  who: string
  email: string | null
  phone: string | null
  sentAt: string | null
  sentChannel: 'email' | 'sms' | null
  isDraft: boolean
  /** The customer's copy as it would go out now — for a draft, as issuing would stamp it. */
  paper: PublicInvoice
  /** The business's sales-tax rate label, or null when its state has no known rate. */
  taxLabel: string | null
  primary?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [taxBusy, setTaxBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Opens on the channel it last went by, or on whichever address exists. An invoice goes by email
  // when there is one; a customer who has only ever texted gets a text.
  const [channel, setChannel] = useState<'email' | 'sms'>(sentChannel ?? (email ? 'email' : phone ? 'sms' : 'email'))
  const [to, setTo] = useState(channel === 'sms' ? (phone ?? '') : (email ?? ''))
  const [notes, setNotes] = useState(paper.notes ?? '')
  const taxOn = paper.taxCents > 0

  function pick(next: 'email' | 'sms') {
    setChannel(next)
    // Only replace what was typed if the field still holds the OTHER channel's address. Somebody who
    // typed a one-off address and then changed their mind about the channel keeps their typing.
    const other = next === 'sms' ? phone : email
    const current = next === 'sms' ? email : phone
    if (!to.trim() || to.trim() === (current ?? '').trim()) setTo(other ?? '')
  }

  function close() {
    if (busy) return
    setOpen(false); setErr(null); setNotes(paper.notes ?? '')
  }

  // The method is explicit: the document route is PATCH, issue and send are POST. Inferring it from
  // whether there is a body sent the send as PATCH and every send answered 405.
  async function call(method: 'POST' | 'PATCH', url: string, body?: unknown): Promise<string | null> {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      return !res.ok || j.ok === false ? (j.error || `That did not work (error ${res.status}).`) : null
    } catch {
      return 'Check your connection.'
    }
  }

  // The rate is the server's, from the business's state; the sheet only says on or off. The paper
  // below re-reads from the server, so the total shown is the one that will be issued.
  async function toggleTax() {
    if (taxBusy || !isDraft) return
    setTaxBusy(true); setErr(null)
    const e = await call('PATCH', `/api/core/documents/invoice/${invoiceId}`, { taxable: !taxOn })
    if (e) setErr(e)
    router.refresh()
    setTaxBusy(false)
  }

  async function send() {
    if (busy || !to.trim()) return
    setBusy(true); setErr(null)
    if (isDraft) {
      if (notes.trim() !== (paper.notes ?? '').trim()) {
        const e = await call('PATCH', `/api/core/documents/invoice/${invoiceId}`, { notes: notes.trim() || null })
        if (e) { setErr(`The comments did not save: ${e}`); setBusy(false); return }
      }
      const e = await call('POST', `/api/core/documents/invoice/${invoiceId}/issue`)
      if (e) { setErr(e); setBusy(false); router.refresh(); return }
    }
    // The route's sentence, verbatim — it already knows whether the provider refused it, and the
    // difference between "sent" and "we tried to send" is the whole reason it answers in words.
    const e = await call('POST', `/api/core/documents/invoice/${invoiceId}/send`, { channel, to: to.trim() })
    setBusy(false)
    if (e) {
      // Issued but not sent is a real state, and the one the owner must not miss.
      setErr(isDraft ? `${number} is issued, but it did not go out: ${e}` : e)
      router.refresh()
      return
    }
    setOpen(false)
    router.refresh()
  }

  const ago = sentAt ? relative(sentAt) : null

  return (
    <>
      <button type="button" className="v2-iv-btn" data-p={primary || undefined} data-touch onClick={() => setOpen(true)}>
        <Send />{sentAt ? 'Resend' : 'Send'}
      </button>

      {open && (
        <Sheet title={sentAt ? `Resend ${number}` : `Send ${number}`} wide busy={busy} onClose={close}>
          <p className="v2-iv-ss">
            {who} · {ago ? `last sent ${ago}${sentChannel ? ` by ${sentChannel === 'sms' ? 'SMS' : 'email'}` : ''}` : 'not sent yet'}
          </p>

          {isDraft && (
            <>
              <label className="v2-efield">
                <span>Comments on the invoice</span>
                <textarea
                  value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} disabled={busy}
                  placeholder="Delivery date, terms, a thank-you — printed on the customer's copy"
                />
              </label>
              {taxLabel && (
                <label className="v2-iv-tax">
                  <input type="checkbox" checked={taxOn} onChange={() => void toggleTax()} disabled={busy || taxBusy} />
                  <span>Add {taxLabel}</span>
                  {taxBusy && <em>updating…</em>}
                </label>
              )}
            </>
          )}

          <p className="v2-iv-fl">HOW</p>
          <div className="v2-iv-methods">
            <button type="button" className="v2-iv-mth" data-on={channel === 'email' || undefined} onClick={() => pick('email')} disabled={busy}>Email</button>
            <button type="button" className="v2-iv-mth" data-on={channel === 'sms' || undefined} onClick={() => pick('sms')} disabled={busy}>Text</button>
          </div>

          <p className="v2-iv-fl">{channel === 'sms' ? 'PHONE NUMBER' : 'EMAIL ADDRESS'}</p>
          <input
            className="v2-iv-fld"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            type={channel === 'sms' ? 'tel' : 'email'}
            placeholder={channel === 'sms' ? '(555) 123-4567' : 'name@example.com'}
            disabled={busy}
            aria-label={channel === 'sms' ? 'Phone number' : 'Email address'}
          />
          {/* An address typed here is used for THIS send and is not written back to the contact. A
              one-off copy to a bookkeeper must not silently become the customer's address. */}
          <p className="v2-iv-leftover">
            They get {channel === 'sms' ? 'a text' : 'an email'} with a link to this page.
            {isDraft ? ' Sending issues it: the total and the date are fixed from then on.' : ' Sending it again does not change the number or the total.'}
          </p>

          <p className="v2-iv-fl">WHAT THEY WILL SEE</p>
          <div className="v2-iv-preview" aria-label="Preview of the customer's invoice">
            <InvoicePaper inv={{ ...paper, notes: isDraft ? (notes.trim() || null) : paper.notes }} />
          </div>

          {err && <p className="v2-emsg" data-bad>{err}</p>}

          <button type="button" className="v2-iv-save" onClick={() => void send()} disabled={busy || taxBusy || !to.trim()}>
            {busy ? 'Sending…' : isDraft ? `Issue & send ${number}` : sentAt ? 'Send it again' : 'Send it'}
          </button>
        </Sheet>
      )}
    </>
  )
}

function relative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
