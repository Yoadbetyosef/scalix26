'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../form-sheet'
import { Pin, Cam } from './glyphs'

// THE AMBER ROW'S FIX, MADE REAL.
//
// The agenda names the gap on a row that is missing the one thing its kind needs, and promotes the
// fix to the first action. Until now that action rendered disabled: PATCH /api/appointments/[id]
// accepted `status` and `skip_review` and nothing else, so there was no route behind the button.
//
// A row that names a problem and offers a button that cannot solve it is worse than a row that says
// nothing — it promises a fix and spends the owner's attention finding out there isn't one.
//
// ── IT IS SMALLER THAN IT WAS ───────────────────────────────────────────────────────────────────
//
// Most of the amber rows this was built for were never missing anything: they were at_business jobs
// mislabelled as on_site, and the fifth kind deletes them rather than fixing them. What is left is
// the real case — a job we ARE travelling to where nobody wrote down where, and a video call with no
// link — and that case deserves a working button.
//
// ── BLANK CLEARS ────────────────────────────────────────────────────────────────────────────────
//
// The field opens on whatever is there and saving it empty removes it. "We had the wrong address and
// now we have none" is a real state — it is exactly what the amber row means — and refusing to
// express it would leave the only correction being a different wrong address.

export function FixPlace({
  appointmentId, missing, current, who,
}: {
  appointmentId: string
  missing: 'address' | 'link'
  current: string | null
  who: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [value, setValue] = useState(current ?? '')

  const isAddress = missing === 'address'

  function close() { setOpen(false); setBusy(false); setErr(null); setValue(current ?? '') }

  async function save() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // One key. The route accepts status and skip_review too, and sending them from here would
        // be this sheet having an opinion about whether the appointment happened.
        body: JSON.stringify(isAddress ? { address: value } : { join_url: value }),
      })
      const j = await res.json().catch(() => ({}))
      // The route's own sentence — it is the half that knows a link is not a link.
      if (!res.ok) { setErr(j.error || 'That could not be saved.'); return }
      close()
      router.refresh()
    } catch {
      setErr('That could not be saved — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-ag-act" data-fix onClick={() => setOpen(true)}>
        {isAddress ? <Pin /> : <Cam />}
        {isAddress ? 'Add address' : 'Add link'}
      </button>

      {open && (
        <Sheet title={isAddress ? 'Where is it?' : 'Joining link'} busy={busy} onClose={close}>
          <p className="v2-iv-ss">{who}</p>

          <label className="v2-efield">
            <span>{isAddress ? 'Address' : 'Link'}</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isAddress ? '140 Main St, Vancouver' : 'https://…'}
              inputMode={isAddress ? 'text' : 'url'}
              disabled={busy}
              autoFocus
            />
          </label>

          <p className="v2-ehint">
            {isAddress
              ? 'Leave it empty to remove the address. If the customer is coming to you, change the appointment to At the shop instead — it needs no address at all.'
              : 'Leave it empty to remove the link.'}
          </p>

          {err && <p className="v2-emsg" data-bad>{err}</p>}

          <div className="v2-eacts">
            <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="v2-epri" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
