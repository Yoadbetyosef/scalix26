'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readJson } from '@/lib/http/read-response'
import { INVOICE_ACCEPT_ATTR, invoiceFileError } from '@/lib/invoices/types'
import { prepareReceipt } from '@/lib/expenses/downscale'
import type { ReceiptReading } from '@/lib/expenses/extract'
import { ExpenseSheet, Plus } from '../expenses/sheet'

// THE ONE DOOR, ON SCREEN. See lib/invoices/OUTSTANDING.md §10.
//
// One component, FOUR placements — the Money out header and empty state, the Supplier bills header
// and empty state — because the invariant is one PATH, not one location. An owner standing in
// Supplier bills who has a supplier bill in their hand should not have to go somewhere else to put it
// in; a redirect there would be a crossing out of the screen they are standing in, which
// no-escape.test.ts refuses and which is a dead end on a phone.
//
// What makes it one door is that all four placements post the same file to the same endpoint and
// obey the same answer. Nobody chooses "expense" or "supplier bill" anywhere on this screen — the
// document decides, and for a tenant with no catalogue there is nothing to decide.
//
// ── TWO PICKERS IS NOT TWO DOORS ────────────────────────────────────────────────────────────────
//
// A camera and a file picker are genuinely different pickers, and a phone cannot offer both from one
// input: `capture="environment"` goes straight to the rear camera, which is what makes the receipt
// case one tap, and an input carrying it cannot reach a PDF that is already on the device.
//
// So there are two controls and one send(). Snap is primary because a receipt in somebody's hand is
// the common case and typing it is the work this feature deletes; choosing a file is the quieter
// second control, and it is the one a fifteen-page supplier invoice arrives through. They are not two
// doors: neither of them decides anything, and both hand the same bytes to the same classifier.
//
// ── WHY THE SHEET, AND WHY THE PUSH ─────────────────────────────────────────────────────────────
//
// An expense landing opens the expense sheet with the reading already in it — the sheet is not asked
// to read again, because the door has read it and a second read is money spent to learn what is
// already on screen. A bill landing navigates, because a bill is not a form: it is a screen with a
// coverage gate, an allocation and matching work on it.

const READ_TIMEOUT_MS = 20_000

/** What the door answered. Mirrors `Landing` in lib/money-out/door.ts. */
type Landing =
  | { kind: 'expense'; reading: ReceiptReading; fileHash: string; duplicate: Duplicate | null }
  | { kind: 'bill'; shipmentId: string; duplicate: { shipmentId: string; reference: string | null } | null }

interface Duplicate { where: 'expense' | 'bill'; id: string; label: string }

export function MoneyOutDoor({ showsTax, tone = 'header' }: {
  showsTax: boolean
  tone?: 'header' | 'empty'
}) {
  const router = useRouter()
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dupe, setDupe] = useState<Duplicate | null>(null)
  // The expense outcome: the file that came in, and the reading that came back with it.
  const [landed, setLanded] = useState<{ file: File; reading: ReceiptReading | null; fileHash: string | null } | null>(null)
  // The camera was opened and dismissed with nothing taken — so today goes back to being a guess
  // rather than a claim about a receipt. Same rule the expenses Add button has always had.
  const [expectPhoto, setExpectPhoto] = useState(true)

  useEffect(() => {
    const el = camera.current
    if (!el) return
    const onCancel = () => setExpectPhoto(false)
    el.addEventListener('cancel', onCancel)
    return () => el.removeEventListener('cancel', onCancel)
  }, [])

  async function send(file: File) {
    // The server's own rule, at the picker, so a file that is going to be refused is refused before
    // it is uploaded rather than after.
    const problem = invoiceFileError(file.name, file.size)
    if (problem) { setErr(problem); return }

    setBusy(true); setErr(null); setDupe(null)

    // ONE prepare, here, before anything is sent. A photograph is redrawn twice — a stored copy at
    // 2000px and a smaller one at 1600px for the model — and the small one is what a person actually
    // waits on. A PDF passes straight through untouched: `read` is null and there is nothing to
    // redraw. Doing it here rather than inside the sheet means the same photograph is never encoded
    // twice, and that the hash the duplicate check stores is of the bytes that were actually read.
    let prepared: { stored: File; read: File | null }
    try {
      prepared = await prepareReceipt(file)
    } catch {
      prepared = { stored: file, read: null }
    }
    const forReading = prepared.read ?? prepared.stored

    // Twenty seconds is how long somebody will stand holding a phone, and it is NOT the server's
    // ceiling — a long document legitimately takes minutes there. On a timeout the expense sheet
    // opens with nothing filled in, which is the form that has always existed and still works.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS)
    try {
      const body = new FormData()
      body.append('file', forReading)
      const res = await fetch('/api/money-out', { method: 'POST', body, signal: ctrl.signal })
      // readJson, not res.json(): an oversized upload is refused by the platform edge in plain text,
      // before this route exists as far as Vercel is concerned.
      const landing = await readJson<Landing>(res, 'That document could not be read.')

      if (landing.kind === 'bill') {
        if (landing.duplicate) { setDupe({ where: 'bill', id: landing.duplicate.shipmentId, label: landing.duplicate.reference || 'a supplier bill' }) }
        router.push(`/v2/bills/${landing.shipmentId}`)
        return
      }

      if (landing.duplicate) setDupe(landing.duplicate)
      setLanded({ file: prepared.stored, reading: landing.reading, fileHash: landing.fileHash })
    } catch {
      // A timeout, a network failure, a model error. The form still works, so this opens it empty
      // rather than reporting an incident: the person types what they already know.
      setLanded({ file: prepared.stored, reading: null, fileHash: null })
    } finally {
      clearTimeout(timer)
      setBusy(false)
      if (camera.current) camera.current.value = ''
      if (picker.current) picker.current.value = ''
    }
  }

  function openCamera() {
    setExpectPhoto(true)
    if (camera.current) { camera.current.value = ''; camera.current.click() }
  }

  return (
    <>
      {/* capture="environment" asks for the rear camera directly on a phone and is ignored on a
          desktop, where it is an ordinary picker. It cannot reach a file already on the device,
          which is what the second input is for. */}
      <input
        ref={camera}
        type="file"
        accept={INVOICE_ACCEPT_ATTR}
        capture="environment"
        className="v2-hidden-file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); else setExpectPhoto(false) }}
      />
      <input
        ref={picker}
        type="file"
        accept={INVOICE_ACCEPT_ATTR}
        className="v2-hidden-file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { setExpectPhoto(false); void send(f) } }}
      />

      <div className="v2-mo-acts" data-tone={tone}>
        <button type="button" className="v2-hact" data-tone="primary" data-touch onClick={openCamera} disabled={busy}>
          <Plus />{busy ? 'Reading…' : tone === 'header' ? 'Add' : 'Add a bill'}
        </button>
        {/* The quieter half. A supplier invoice PDF arrives here, and so does the receipt somebody
            photographed an hour ago and already has in their library. */}
        <button type="button" className="v2-mo-file" onClick={() => picker.current?.click()} disabled={busy}>
          or choose a file
        </button>
      </div>

      {err && <p className="v2-emsg" data-bad>{err}</p>}
      {dupe && (
        <p className="v2-emsg">
          {`You have put this exact file in before — ${dupe.label}.`}{' '}
          <a href={dupe.where === 'bill' ? `/v2/bills/${dupe.id}` : '/v2/expenses'}>Open the one you already have</a>
          {', or carry on and keep both.'}
        </p>
      )}

      {landed && (
        <ExpenseSheet
          showsTax={showsTax}
          initialFile={landed.file}
          initialReading={landed.reading}
          prepared={{ already: true, fileHash: landed.fileHash }}
          expectPhoto={expectPhoto}
          onClose={() => { setLanded(null); setDupe(null) }}
        />
      )}
    </>
  )
}
