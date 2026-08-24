'use client'

import { useState } from 'react'
import { Modal } from '@/components/v2/modal'

// THE MODAL, SHOWN TWICE — once as each of the two dialogs /contacts actually opens.
//
// Kit only. Neither /contacts dialog is migrated; both still carry their own inline panel, so this
// is a proposal beside the thing it would replace rather than a change already made.
//
// The static pane on the left of each pair is the dialog as it ships today: the card's edge and the
// veil, assembled by hand inside the component. What it does NOT have is any of the behaviour — no
// focus trap, no escape, no scroll lock, no dialog role — which is the whole reason for promoting it
// and the reason a screenshot cannot show the difference. The buttons below open the real thing so
// the keyboard can be tried on it.

export function ModalDemo({ contacts }: { contacts: { name: string | null; email: string | null; phone: string | null }[] }) {
  const [open, setOpen] = useState<null | 'new' | 'import'>(null)
  const f = { name: '', email: '', phone: '', address: '', notes: '' }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="v2-act" data-solid onClick={() => setOpen('new')}>Open · New contact</button>
        <button type="button" className="v2-act" onClick={() => setOpen('import')}>Open · Import wizard</button>
      </div>

      <Modal
        open={open === 'new'}
        onClose={() => setOpen(null)}
        title="New contact"
        actions={<>
          <button className="v2-act" data-solid onClick={() => setOpen(null)}>Save contact</button>
          <button className="v2-act" onClick={() => setOpen(null)}>Cancel</button>
        </>}
      >
        <p className="v2-hint" style={{ marginBottom: 16 }}>A name, email or phone is enough — the rest can be filled in later.</p>
        <div className="v2-form">
          <div className="v2-fld wide"><label htmlFor="d-name">Name</label><input id="d-name" defaultValue={f.name} /></div>
          <div className="v2-fld"><label htmlFor="d-email">Email</label><input id="d-email" type="email" defaultValue={f.email} /></div>
          <div className="v2-fld"><label htmlFor="d-phone">Phone</label><input id="d-phone" defaultValue={f.phone} /></div>
          <div className="v2-fld wide"><label htmlFor="d-addr">Address</label><input id="d-addr" defaultValue={f.address} /></div>
          <div className="v2-fld">
            <label htmlFor="d-cur">Currency</label>
            <span className="v2-sel"><select id="d-cur" defaultValue=""><option value="">—</option>
              {['usd','cad','gbp','eur','ils'].map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select></span>
          </div>
          <div className="v2-fld wide"><label htmlFor="d-notes">Notes</label><textarea id="d-notes" rows={3} defaultValue={f.notes} /></div>
        </div>
      </Modal>

      <Modal
        open={open === 'import'}
        onClose={() => setOpen(null)}
        title="Import contacts"
        step="check the columns"
        wide
        actions={<>
          <button className="v2-act" data-solid onClick={() => setOpen(null)}>Import {contacts.length} contacts</button>
          <button className="v2-act" onClick={() => setOpen(null)}>Choose a different file</button>
        </>}
      >
        <p className="v2-hint">probe-import.csv — {contacts.length} rows. Check each column is going to the right place.</p>
        <div style={{ marginTop: 16, border: '1px solid var(--v2-line)', borderRadius: 12, overflow: 'auto', maxHeight: 260 }}>
          <table className="v2-tbl" style={{ minWidth: '100%' }}>
            <thead><tr>{['Name','Email','Phone'].map((h) => (
              <th key={h} style={{ verticalAlign: 'top', padding: '10px 10px 8px' }}>
                <div className="mb-1.5 truncate">{h}</div>
                <span className="v2-sel"><select defaultValue={h.toLowerCase()} style={{ fontSize: 12, padding: '5px 22px 5px 0' }}>
                  <option value="">Don&apos;t import</option>
                  {['name','email','phone'].map(k => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
                </select></span>
              </th>
            ))}</tr></thead>
            <tbody>{contacts.slice(0, 5).map((c, i) => (
              <tr key={i}>
                <td style={{ fontSize: 12.5, padding: '8px 10px' }}>{c.name || '—'}</td>
                <td style={{ fontSize: 12.5, padding: '8px 10px' }}>{c.email || '—'}</td>
                <td style={{ fontSize: 12.5, padding: '8px 10px' }}>{c.phone || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {([['will be added', contacts.length, 'var(--v2-t2)'],
             ['already in your contacts', 0, 'var(--v2-t4)'],
             ['skipped', 0, 'var(--v2-ink-45)']] as Array<[string, number, string]>).map(([label, n, hue]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className="sx-tabular" style={{ fontSize: 20, fontWeight: 300, color: 'var(--v2-ink)' }}>{n}</span>
              <span className="v2-stat" style={{ ['--chan' as string]: hue }}>{label}</span>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
