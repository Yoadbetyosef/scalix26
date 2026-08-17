'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../form-sheet'

// NEW APPOINTMENT — the owner's own, in the same sheet every other /v2 form opens.
//
// A disabled create on an empty screen means there is no way to ever put anything there, and the
// empty state is exactly when somebody wants it. This is that button.
//
// ── THE GRID IS OFFERED, NOT ENFORCED ───────────────────────────────────────────────────────────
//
// The free times for the chosen day are shown as one-tap chips, because most of the time that IS
// what you want. But the field accepts any time typed: `appointment_slots` is what the business
// offers strangers, not a statement about what the owner may do. On the live tenant the grid is
// empty Wednesday through Saturday, so an enforced one would refuse most days of the week.
//
// ── NOTHING IS SENT UNLESS ASKED FOR ────────────────────────────────────────────────────────────
//
// An owner is often recording something already agreed on the phone. Texting that customer
// "✅ Confirmed!" out of nowhere cannot be taken back, so the checkbox is off and says exactly what
// would go out.

export interface SlotGrid {
  /** Active slot times per weekday (0 = Sunday), from appointment_slots. */
  byDow: Record<number, string[]>
  /** Times already taken, per date. */
  booked: Record<string, string[]>
}

interface Contact { id: string; name: string | null; phone: string | null; email: string | null }

// FIVE, and the first two are the ones that used to be one. "On site" means YOU TRAVEL — it wants an
// address. "At the shop" means THEY travel, and wants nothing: the place is already known.
const KINDS = [
  { k: 'on_site', label: 'On site' },
  { k: 'at_business', label: 'At the shop' },
  { k: 'zoom', label: 'Zoom' },
  { k: 'google_meet', label: 'Google Meet' },
  { k: 'phone', label: 'Phone call' },
] as const

/** "14:30:00" → "2:30 PM", for the chips. The stored value stays 24h. */
const pretty = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`
}

export function NewAppointment({ grid, defaultMinutes }: { grid: SlotGrid; defaultMinutes: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Contact[]>([])
  const [picked, setPicked] = useState<Contact | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [service, setService] = useState('')
  const [kind, setKind] = useState<string>('on_site')
  const [place, setPlace] = useState('')
  const [minutes, setMinutes] = useState(String(defaultMinutes))
  const [tellThem, setTellThem] = useState(false)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) requestAnimationFrame(() => search.current?.focus()) }, [open])

  // The type-ahead behind /api/contacts/search — the same route and the same searchContacts the order
  // form's picker uses, so an appointment attaches to the person already in the book.
  useEffect(() => {
    if (picked || q.trim().length < 1) { setHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/contacts/search?q=${encodeURIComponent(q.trim())}`)
        const j = await r.json().catch(() => ({}))
        if (!cancelled) setHits((j.contacts ?? []).slice(0, 5))
      } catch { /* a failed lookup must not block typing a new customer */ }
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, picked])

  function close() {
    setOpen(false); setBusy(false); setErr(null)
    setQ(''); setHits([]); setPicked(null); setName(''); setPhone('')
    setDate(''); setTime(''); setService(''); setKind('on_site'); setPlace('')
    setMinutes(String(defaultMinutes)); setTellThem(false)
  }

  // The free times for whatever day is chosen: the grid for that weekday, minus what is taken.
  const free = (() => {
    if (!date) return []
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
    const taken = new Set(grid.booked[date] ?? [])
    return (grid.byDow[dow] ?? []).filter((t) => !taken.has(t))
  })()

  const customerName = picked?.name ?? name
  const customerPhone = picked?.phone ?? phone
  const ready = !!customerPhone.trim() && !!date && !!time

  async function save() {
    if (busy || !ready) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, time,
          customer_name: customerName.trim() || null,
          customer_phone: customerPhone.trim(),
          customer_email: picked?.email || null,
          service_type: service.trim() || null,
          meeting_kind: kind,
          address: kind === 'on_site' ? place.trim() || null : null,
          join_url: kind === 'zoom' || kind === 'google_meet' ? place.trim() || null : null,
          duration_minutes: Number(minutes) || null,
          notify_customer: tellThem,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.detail || j.error || 'That did not save.'); return }
      close()
      router.refresh()
    } catch {
      setErr('That did not save — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-hact" data-tone="primary" data-touch onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        New
      </button>

      {open && (
        <Sheet title="New appointment" wide busy={busy} onClose={close}>
          {/* WHO. An existing contact, or a new one — never a second row for somebody already here. */}
          <label className="v2-efield">
            <span>Customer</span>
            {picked ? (
              <button type="button" className="v2-ap-picked" onClick={() => setPicked(null)}>
                {picked.name || picked.phone || picked.email}<i>change</i>
              </button>
            ) : (
              <input ref={search} value={q} onChange={(e) => { setQ(e.target.value); setName(e.target.value) }} placeholder="Search contacts, or type a name" disabled={busy} />
            )}
          </label>
          {!picked && hits.length > 0 && (
            <div className="v2-ap-hits">
              {hits.map((c) => (
                <button key={c.id} type="button" onClick={() => { setPicked(c); setQ(''); setHits([]) }}>
                  <b>{c.name || 'No name'}</b><span>{c.phone || c.email}</span>
                </button>
              ))}
            </div>
          )}
          {!picked && (
            <label className="v2-efield">
              <span>Phone</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
            </label>
          )}

          <div className="v2-ap-two">
            <label className="v2-efield">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </label>
            <label className="v2-efield">
              <span>Time</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
            </label>
          </div>

          {/* OFFERED, NOT ENFORCED. Any time typed above is accepted. */}
          {date && (
            <div className="v2-ap-slots">
              {free.length > 0 ? free.map((t) => (
                <button key={t} type="button" data-on={time === t.slice(0, 5) || undefined} onClick={() => setTime(t.slice(0, 5))}>{pretty(t)}</button>
              )) : <p className="v2-ehint">Nothing set up for that day — type any time and it will book.</p>}
            </div>
          )}

          <label className="v2-efield">
            <span>What for</span>
            <input value={service} onChange={(e) => setService(e.target.value)} placeholder="AC repair, consultation…" disabled={busy} />
          </label>

          <label className="v2-efield">
            <span>Where</span>
            <div className="v2-ap-kinds">
              {KINDS.map((k) => (
                <button key={k.k} type="button" data-on={kind === k.k || undefined} onClick={() => { setKind(k.k); setPlace('') }} disabled={busy}>{k.label}</button>
              ))}
            </div>
          </label>
          {/* on_site wants an address, video wants a link. at_business and phone want NOTHING —
              the place is already known, and asking is the bug this kind exists to fix. */}
          {kind !== 'phone' && kind !== 'at_business' && (
            <label className="v2-efield">
              <span>{kind === 'on_site' ? 'Address' : 'Joining link'}</span>
              <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={kind === 'on_site' ? '140 Main St…' : 'https://…'} disabled={busy} />
            </label>
          )}

          <label className="v2-efield">
            <span>How long (minutes)</span>
            <input type="number" min={5} max={480} value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={busy} />
          </label>

          {/* OFF, and it says exactly what goes out. */}
          <label className="v2-ap-check">
            <input type="checkbox" checked={tellThem} onChange={(e) => setTellThem(e.target.checked)} disabled={busy} />
            <span>Text the customer a confirmation<i>Sends “✅ Confirmed! Your appointment is on …” to {customerPhone.trim() || 'their number'}</i></span>
          </label>

          {err && <p className="v2-emsg" data-bad>{err}</p>}

          <div className="v2-eacts">
            <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="v2-epri" onClick={() => void save()} disabled={busy || !ready}>
              {busy ? 'Booking…' : 'Book it'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
