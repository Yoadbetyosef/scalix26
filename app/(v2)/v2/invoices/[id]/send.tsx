'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../../form-sheet'
import { Send } from '../glyphs'

// SENDING AN INVOICE TO THE PERSON WHO OWES THE MONEY.
//
// It gets a sheet rather than one press, unlike Issue, because there IS a second answer: which address
// it goes to, and by which channel. A one-press send would use whatever is on the contact record
// without showing it, and the first time somebody notices is when the money does not arrive.
//
// ── A DRAFT DOES NOT GET THIS BUTTON ────────────────────────────────────────────────────────────
//
// The control is not rendered for a draft at all. The route refuses one as well — the button is a
// courtesy, the route is the rule — but showing a disabled Send beside Issue would suggest the two are
// alternatives, when in fact one is a precondition of the other.
//
// ── RESEND SAYS WHEN IT LAST WENT ───────────────────────────────────────────────────────────────
//
// `sent_at` is the MOST RECENT send, so the sheet says "last sent 3 days ago" rather than implying it
// has only ever gone once. The full record is in HISTORY, which gets a row for every send.

export function SendInvoice({
  invoiceId, number, who, email, phone, sentAt, sentChannel,
}: {
  invoiceId: string
  number: string
  who: string
  email: string | null
  phone: string | null
  sentAt: string | null
  sentChannel: 'email' | 'sms' | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Opens on the channel it last went by, or on whichever address exists. An invoice goes by email
  // when there is one; a customer who has only ever texted gets a text.
  const [channel, setChannel] = useState<'email' | 'sms'>(sentChannel ?? (email ? 'email' : phone ? 'sms' : 'email'))
  const [to, setTo] = useState(channel === 'sms' ? (phone ?? '') : (email ?? ''))

  function pick(next: 'email' | 'sms') {
    setChannel(next)
    // Only replace what was typed if the field still holds the OTHER channel's address. Somebody who
    // typed a one-off address and then changed their mind about the channel keeps their typing.
    const other = next === 'sms' ? phone : email
    const current = next === 'sms' ? email : phone
    if (!to.trim() || to.trim() === (current ?? '').trim()) setTo(other ?? '')
  }

  function close() {
    setOpen(false); setBusy(false); setErr(null)
  }

  async function send() {
    if (busy || !to.trim()) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/core/documents/invoice/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, to: to.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      // The route's sentence, verbatim — it already knows whether the provider refused it, and the
      // difference between "sent" and "we tried to send" is the whole reason it answers in words.
      if (!res.ok || j.ok === false) { setErr(j.error || 'That did not send.'); return }
      close()
      router.refresh()
    } catch {
      setErr('That did not send — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const ago = sentAt ? relative(sentAt) : null

  return (
    <>
      <button type="button" className="v2-iv-btn" data-touch onClick={() => setOpen(true)}>
        <Send />{sentAt ? 'Resend' : 'Send'}
      </button>

      {open && (
        <Sheet title={sentAt ? `Resend ${number}` : `Send ${number}`} busy={busy} onClose={close}>
          <p className="v2-iv-ss">
            {who} · {ago ? `last sent ${ago}${sentChannel ? ` by ${sentChannel === 'sms' ? 'SMS' : 'email'}` : ''}` : 'not sent yet'}
          </p>

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
            They get a link to the invoice, with your payment details on it. Sending it again does not
            change the number or the total.
          </p>

          {err && <p className="v2-emsg" data-bad>{err}</p>}

          <button type="button" className="v2-iv-save" onClick={() => void send()} disabled={busy || !to.trim()}>
            {busy ? 'Sending…' : sentAt ? 'Send it again' : 'Send it'}
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
