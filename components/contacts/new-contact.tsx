'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Upload } from 'lucide-react'
import { ImportContacts } from './import-contacts'

// The keys are the API's, not the form's. This posts `f` verbatim, so a friendlier local spelling
// would be dropped by the schema on the way in — which is exactly what happened once.
const empty = { company_name: '', first_name: '', last_name: '', name: '', email: '', phone: '', address: '', currency: '', notes: '' }

// The two ways contacts get into the book by hand: one at a time, or a whole file at once.
// Everything else in the address book is created automatically from conversations.
export function ContactActions() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const close = () => { setOpen(false); setF(empty); setErr(null) }

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      const j = await r.json()
      // 409 means this person is already in the book — say who, rather than a bare failure.
      if (r.status === 409 && j.duplicateOf) {
        const d = j.duplicateOf
        throw new Error(`Already in your contacts: ${d.name || d.email || d.phone}.`)
      }
      if (!r.ok) throw new Error(j.detail || j.error || 'Could not save the contact')
      close(); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-2">
      <ImportContacts trigger={<span className="v2-act"><Upload className="h-3.5 w-3.5" /> Import file</span>} />
      {/* New contact is the one verb on this screen you are meant to reach for, so it is the filled
          pill; Import is the same pill hollow. Two shapes would have been two components. */}
      <button onClick={() => setOpen(true)} className="v2-act" data-solid>
        <Plus className="h-3.5 w-3.5" /> New contact
      </button>

      {open && (
        /* A CENTRED MODAL, WHICH THE KIT DOES NOT HAVE — noted rather than smuggled in. The kit has a
           bottom drawer (.v2-drawer), which is the phone's answer, and a card. This is that card's
           edge language at dialog size on the same dimmed veil: one hairline border, no shadow, the
           form's rules inside it. If Yoad wants a real modal pair in the kit, this is the candidate. */
        <div className="v2 fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" onClick={() => !busy && close()}>
          <div className="v2-veil" />
          <div
            className="relative my-12 w-full max-w-lg"
            style={{ background: 'var(--v2-paper)', border: '1px solid var(--v2-line)', borderRadius: 16, padding: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="v2-head" style={{ marginBottom: 18 }}>
              <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />New contact</p>
              <s />
            </div>
            <p className="v2-hint" style={{ marginBottom: 16 }}>A name, company, email or phone is enough — the rest can be filled in later.</p>

            <div className="v2-form">
              {/* A business customer leads with the business. Optional, and empty on most contacts —
                  which is why it is not the autofocused field: the common case is still a person. */}
              <div className="v2-fld wide">
                <label htmlFor="nc-company">Company</label>
                <input id="nc-company" value={f.company_name} onChange={set('company_name')} placeholder="Optional — for a business customer" />
              </div>
              <div className="v2-fld">
                <label htmlFor="nc-first">First name</label>
                <input id="nc-first" value={f.first_name} onChange={set('first_name')} autoFocus />
              </div>
              <div className="v2-fld">
                <label htmlFor="nc-last">Last name</label>
                <input id="nc-last" value={f.last_name} onChange={set('last_name')} />
              </div>
              <div className="v2-fld">
                <label htmlFor="nc-email">Email</label>
                <input id="nc-email" value={f.email} onChange={set('email')} type="email" />
              </div>
              <div className="v2-fld">
                <label htmlFor="nc-phone">Phone</label>
                <input id="nc-phone" value={f.phone} onChange={set('phone')} />
              </div>
              <div className="v2-fld wide">
                <label htmlFor="nc-address">Address</label>
                <input id="nc-address" value={f.address} onChange={set('address')} />
              </div>
              <div className="v2-fld">
                <label htmlFor="nc-currency">Currency</label>
                <span className="v2-sel">
                  <select id="nc-currency" value={f.currency} onChange={set('currency')}>
                    <option value="">—</option>
                    {['usd', 'cad', 'gbp', 'eur', 'ils'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </select>
                </span>
              </div>
              <div className="v2-fld wide">
                <label htmlFor="nc-notes">Notes</label>
                <textarea id="nc-notes" value={f.notes} onChange={set('notes')} rows={3} />
              </div>
            </div>

            {/* The kit's alert row, the same one the takeover banner uses — not a red block. */}
            {err && (
              <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 16 }}>
                <p>{err}</p>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button onClick={save} disabled={busy} className="v2-act" data-solid>{busy ? 'Saving…' : 'Save contact'}</button>
              <button onClick={close} disabled={busy} className="v2-act">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
