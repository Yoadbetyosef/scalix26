'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../form-sheet'
import { ContactPick, createContactFor, type PickedContact } from '../contact-pick'
import { Plus } from './glyphs'

// A NEW INVOICE.
//
// ── THE SHEET IS THE TRANSACTION ────────────────────────────────────────────────────────────────
//
// Nothing is written until Save. The alternative — create the document, then add lines as they are
// typed — leaves a numbered, listed, EMPTY draft behind on every abandoned form, and burns an invoice
// number doing it. Collecting first means one number per completed invoice.
//
// ── THE ONE FAILURE THAT SURVIVES, AND WHY IT IS TOLD TWICE ─────────────────────────────────────
//
// Creating a document and adding its lines cannot be one atomic call without a second write path that
// would have to know about the freeze trigger and the recompute. So one failure remains: the document
// is created and a line does not save. The invoice then exists, in drafts, with a total that is right
// for the lines it has and wrong for the invoice somebody meant.
//
// That is the exact thing a toast would lose. So it is said TWICE:
//
//   1. The sheet REFUSES TO CLOSE. It becomes a report of what happened, with a link to the draft.
//      Dismissing it is a deliberate act by the person who just read it.
//   2. A note is written to document_status_history, so the invoice itself carries it forever and
//      the HISTORY block on the detail screen shows it. An owner who closed the sheet, went to lunch
//      and came back still finds out.
//
// ── NO DISCOUNT OR TAX FIELD ────────────────────────────────────────────────────────────────────
//
// The engine supports both per line. Tax is jurisdictional, and a free-text cents box invites somebody
// to type a number they computed wrong — better no field than that. It gets designed when a tenant who
// actually charges tax is in front of us. Totals are identical for everyone else.

interface Line { id: number; description: string; quantity: string; unitPrice: string }

const blank = (id: number): Line => ({ id, description: '', quantity: '1', unitPrice: '' })
const cents = (v: string) => Math.round((Number(String(v).replace(/[^0-9.]/g, '')) || 0) * 100)
const qty = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function NewInvoice() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [picked, setPicked] = useState<PickedContact | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [lines, setLines] = useState<Line[]>([blank(1)])
  const [nextId, setNextId] = useState(2)

  /** Set only when the document was created and something after it was not. Closes nothing. */
  const [partial, setPartial] = useState<{ id: string; number: string; message: string } | null>(null)

  // Shown while typing, never sent. createDocument recomputes the header from the lines it stored,
  // so the only total that exists is the one the server derived.
  const preview = lines.reduce((s, l) => s + Math.round(qty(l.quantity) * cents(l.unitPrice)), 0)
  const usable = lines.filter((l) => l.description.trim() && cents(l.unitPrice) > 0 && qty(l.quantity) > 0)
  // ONE OF THE THREE, which is exactly what createContact requires — it refuses only when all three
  // are empty. Phone is NOT required: an invoice usually goes by email, and demanding a number would
  // block a customer who has only ever written to you. Neither is email, because a walk-in with a
  // name and a cheque is also real.
  const ready = (!!picked || !!name.trim() || !!email.trim() || !!phone.trim()) && usable.length > 0

  function reset() {
    setPicked(null); setName(''); setEmail(''); setPhone(''); setLines([blank(1)]); setNextId(2)
    setErr(null); setPartial(null); setBusy(false)
  }
  function close() { setOpen(false); reset() }

  async function save() {
    if (busy || !ready) return
    setBusy(true); setErr(null)

    // 1 ── the customer. An existing one is used as-is; a typed one is created, and a 409 means they
    //      are already in the book, so we use THAT record rather than refusing the invoice.
    //
    //      createContact dedupes on EMAIL and on the last ten digits of the phone, so an address that
    //      already belongs to somebody collides exactly the way a number does — and the search above
    //      matches email too, so most of the time the person is offered before it gets this far.
    let contactId = picked?.id ?? null
    if (!contactId) {
      const r = await createContactFor({ name, email, phone })
      if (r.duplicateOf) {
        contactId = r.duplicateOf.id
        setPicked(r.duplicateOf)
      } else if (!r.ok || !r.contact) {
        setErr(r.error || 'That customer could not be saved.'); setBusy(false); return
      } else {
        contactId = r.contact.id
        setPicked(r.contact)
      }
    }

    // 2 ── the document. Nothing has been written until this point.
    let docId: string, number: string
    try {
      const res = await fetch('/api/core/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'invoice', contactId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) { setErr(j.error || 'The invoice could not be created.'); setBusy(false); return }
      docId = j.document.id
      number = j.document.number
    } catch {
      setErr('The invoice could not be created — check your connection.'); setBusy(false); return
    }

    // 3 ── the lines, one call each. N+1 by design: a bulk endpoint would be a second write path that
    //      has to know about the freeze trigger and the recompute, to save a few round trips on a form
    //      used a few times a day. Recorded in OUTSTANDING rather than pre-solved.
    const failed: number[] = []
    for (let i = 0; i < usable.length; i++) {
      const l = usable[i]
      try {
        const res = await fetch(`/api/core/documents/invoice/${docId}/lines`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: l.description.trim(),
            quantity: qty(l.quantity),
            unit_price_cents: cents(l.unitPrice),
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j.ok) failed.push(i + 1)
      } catch {
        failed.push(i + 1)
      }
    }

    if (failed.length) {
      const which = failed.length === 1 ? `Line ${failed[0]}` : `Lines ${failed.join(', ')}`
      const message = `${number} was created, but ${which} of ${usable.length} did not save. Its total is lower than you meant. It is in your drafts.`
      // Written to the document's own history, so this outlives the sheet, the tab and the day.
      // The detail screen renders HISTORY, so the invoice carries the explanation with it.
      try {
        await fetch(`/api/core/documents/invoice/${docId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'draft', note: message }),
        })
      } catch { /* the sheet still says it; this is the durable copy, not the only one */ }
      setPartial({ id: docId, number, message })
      setBusy(false)
      router.refresh()
      return
    }

    close()
    router.push(`/v2/invoices/${docId}`)
  }

  return (
    <>
      <button type="button" className="v2-hact" data-tone="primary" data-touch onClick={() => setOpen(true)}>
        <Plus />New
      </button>

      {open && (
        <Sheet title={partial ? 'Something did not save' : 'New invoice'} wide busy={busy} onClose={partial ? () => {} : close}>
          {partial ? (
            // A REPORT, not a toast. There is no veil dismissal and no Cancel — the only ways out are
            // opening the draft or acknowledging it, both of which require having read it.
            <>
              <p className="v2-iv-leftover" data-bad>{partial.message}</p>
              <p className="v2-ehint">The same note is on the invoice&apos;s history, so you can find it again.</p>
              <div className="v2-eacts">
                <button type="button" className="v2-esec" onClick={() => { setOpen(false); reset(); router.refresh() }}>
                  I&apos;ll fix it later
                </button>
                <button type="button" className="v2-epri" onClick={() => { setOpen(false); reset(); router.push(`/v2/invoices/${partial.id}`) }}>
                  Open {partial.number}
                </button>
              </div>
            </>
          ) : (
            <>
              <ContactPick picked={picked} onPick={(c) => { setPicked(c); if (!c) { setName(''); setEmail(''); setPhone('') } }} disabled={busy} autoFocus />
              {!picked && (
                <>
                  <label className="v2-efield">
                    <span>Name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
                  </label>
                  {/* EMAIL FIRST, and before phone. An invoice usually goes by email, and without an
                      address there is nothing to send it to — a customer who is not already a contact
                      could never be invoiced properly. */}
                  <label className="v2-efield">
                    <span>Email</span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
                  </label>
                  <label className="v2-efield">
                    <span>Phone</span>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
                  </label>
                  <p className="v2-ehint">A name, an email or a phone number — any one is enough.</p>
                </>
              )}

              <p className="v2-iv-fl">WHAT THEY ARE PAYING FOR</p>
              {lines.map((l, i) => (
                <div key={l.id} className="v2-in-line">
                  <input
                    className="v2-iv-fld" value={l.description} placeholder="Description"
                    onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, description: e.target.value } : x)))}
                    disabled={busy} aria-label={`Line ${i + 1} description`}
                  />
                  <input
                    className="v2-iv-fld" data-qty value={l.quantity} inputMode="decimal"
                    onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, quantity: e.target.value } : x)))}
                    disabled={busy} aria-label={`Line ${i + 1} quantity`}
                  />
                  <input
                    className="v2-iv-fld" data-price value={l.unitPrice} placeholder="0.00" inputMode="decimal"
                    onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, unitPrice: e.target.value } : x)))}
                    disabled={busy} aria-label={`Line ${i + 1} unit price`}
                  />
                  {lines.length > 1 && (
                    <button type="button" className="v2-in-x" onClick={() => setLines(lines.filter((x) => x.id !== l.id))} disabled={busy} aria-label="Remove line">×</button>
                  )}
                </div>
              ))}
              <button type="button" className="v2-in-add" onClick={() => { setLines([...lines, blank(nextId)]); setNextId(nextId + 1) }} disabled={busy}>
                + Add a line
              </button>

              {/* Shown, never sent. The server recomputes the header from the lines it stored, so this
                  is a preview of the arithmetic and not the source of it. */}
              <div className="v2-in-total">
                <span>Total</span>
                <span>{money(preview)}</span>
              </div>

              {err && <p className="v2-emsg" data-bad>{err}</p>}

              <p className="v2-ehint">It saves as a draft. Nothing goes to the customer until you issue it.</p>

              <div className="v2-eacts">
                <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
                <button type="button" className="v2-epri" onClick={() => void save()} disabled={busy || !ready}>
                  {busy ? 'Saving…' : 'Save draft'}
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
