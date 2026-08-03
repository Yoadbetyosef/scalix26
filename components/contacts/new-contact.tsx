'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Upload } from 'lucide-react'
import { ImportContacts } from './import-contacts'

const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'
const empty = { name: '', email: '', phone: '', address: '', currency: '', notes: '' }

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
      <ImportContacts trigger={
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken">
          <Upload className="h-3.5 w-3.5" /> Import file
        </span>
      } />
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
        <Plus className="h-4 w-4" /> New contact
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !busy && close()}>
          <div className="my-12 w-full max-w-lg rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">New contact</h3>
            <p className="mt-0.5 text-xs text-gray-500">A name, email or phone is enough — the rest can be filled in later.</p>

            <div className="mt-4 space-y-3">
              <label className="block text-xs text-gray-500">Name<input value={f.name} onChange={set('name')} autoFocus className={inp} /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-gray-500">Email<input value={f.email} onChange={set('email')} type="email" className={inp} /></label>
                <label className="block text-xs text-gray-500">Phone<input value={f.phone} onChange={set('phone')} className={inp} /></label>
              </div>
              <label className="block text-xs text-gray-500">Address<input value={f.address} onChange={set('address')} className={inp} /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-gray-500">
                  Currency
                  <select value={f.currency} onChange={set('currency')} className={inp}>
                    <option value="">—</option>
                    {['usd', 'cad', 'gbp', 'eur', 'ils'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-xs text-gray-500">Notes<textarea value={f.notes} onChange={set('notes')} rows={3} className={inp} /></label>
            </div>

            {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={save} disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">{busy ? 'Saving…' : 'Save contact'}</button>
              <button onClick={close} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
