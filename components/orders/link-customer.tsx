'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Modal } from '@/components/v2/modal'
import { useConfirm } from '@/components/v2/confirm'
import { ContactPicker, type PickedContact } from './contact-picker'

// An order that is not linked to a customer record says so, and offers the one honest fix: pick
// an EXISTING customer from the address book. Nothing is matched by name; the choice is a person's,
// it is confirmed, it goes on the timeline, and it can be undone.
//
// Older orders were typed as walk-ins before orders learned to link themselves; the audit left the
// ambiguous ones for exactly this control.
export function LinkCustomer({ orderId, contactId, customerName, customerCompany }: {
  orderId: string; contactId: string | null; customerName: string | null; customerCompany: string | null
}) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pick, setPick] = useState<PickedContact>({ id: null, name: '', company: '', email: '', phone: '', address: '', currency: 'usd' })

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail || j.error || 'Could not update the customer link.')
      setOpen(false); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const link = async () => {
    if (!pick.id) { setErr('Choose a customer from the list — typing a name does not link anyone.'); return }
    if (!(await ask({ title: 'Link this order to the customer?', body: `${[pick.company, pick.name].filter(Boolean).join(' — ')} will own this order in their history. The name typed on the order is kept as it was.`, confirmLabel: 'Link customer' }))) return
    // ONLY the id: the typed customer fields on the order are a snapshot and stay as they were.
    await patch({ contactId: pick.id })
  }
  const unlink = async () => {
    if (!(await ask({ title: 'Unlink this order from the customer?', body: 'The order keeps the name, email and phone typed on it; it just stops appearing in that customer\'s history. This is recorded on the timeline.', confirmLabel: 'Unlink', danger: true }))) return
    await patch({ contactId: null })
  }

  if (contactId) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Link href={`/contacts/${contactId}`} className="v2-act">Customer ↗</Link>
        <button onClick={unlink} disabled={busy} className="v2-act" style={{ fontSize: 12 }}>Unlink</button>
        {err && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-red-ink)' }}>{err}</span>}
        {dialog}
      </span>
    )
  }
  return (
    <>
      <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
        <p>
          <b>Not linked to a customer.</b> {customerCompany || customerName ? `“${customerCompany || customerName}” is typed on the order but does not point at a customer record, so this order is not in anyone's history.` : 'No customer record owns this order.'}{' '}
          <button onClick={() => { setErr(null); setOpen(true) }} className="v2-act" data-solid style={{ marginLeft: 6 }}>Link customer</button>
        </p>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} dismissable={!busy} title="Link to an existing customer" wide
        actions={<>
          <button onClick={link} disabled={busy || !pick.id} className="v2-act" data-solid>{busy ? 'Linking…' : 'Link customer'}</button>
          <button onClick={() => setOpen(false)} disabled={busy} className="v2-act">Cancel</button>
        </>}>
        <p className="v2-hint" style={{ marginBottom: 12 }}>Start typing and pick the customer from the list. Only a picked customer links — a typed name on its own never does. Nothing typed on the order changes.</p>
        <ContactPicker value={pick} onChange={setPick} />
        {pick.id && <p className="v2-hint" style={{ marginTop: 10 }}>Will link to <b>{[pick.company, pick.name].filter(Boolean).join(' — ')}</b>{pick.email ? ` · ${pick.email}` : ''}.</p>}
        {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 12 }}><p>{err}</p></div>}
      </Modal>
      {dialog}
    </>
  )
}
