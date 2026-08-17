'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { INVOICE_ACCEPT_ATTR, invoiceFileError } from '@/lib/invoices/types'
import { readJson } from '@/lib/http/read-response'
import { Upload } from './glyphs'

// UPLOADING A SUPPLIER BILL, FROM /v2.
//
// The route already exists and is not v1's: POST /api/invoices/shipments takes a FormData file,
// resolves the tenant from the session, reads the invoice and returns a shipment id. v1's
// /landed-cost page is a second CALLER of it, not the owner of it — so this is the same path rather
// than a link out of the preview, which no-escape would refuse anyway and which would be a dead end
// on a phone.
//
// ── IT LIVES IN TWO PLACES, ON PURPOSE ──────────────────────────────────────────────────────────
//
// The header, because that is where an action lives on every other /v2 screen. And the empty state,
// because that is the moment somebody most wants to do it — a screen that says "upload one and it
// gets read" while offering no way to is making a promise it cannot keep.
//
// One component, two placements, so the two cannot drift into meaning different things.
//
// ── THE FILE IS CHECKED BEFORE IT IS SENT ───────────────────────────────────────────────────────
//
// With `invoiceFileError`, the SAME function the server enforces — so a HEIC or an oversized file is
// refused at the picker rather than after a 20 MB round trip. And the response is read with
// readJson: an oversized upload is refused by the platform edge with plain text, before this route
// exists as far as Vercel is concerned, so res.json() would throw a parse error over the real one.

export function UploadBill({ tone = 'header' }: { tone?: 'header' | 'empty' }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dupe, setDupe] = useState<{ shipmentId: string; reference: string | null } | null>(null)

  async function send(file: File) {
    const problem = invoiceFileError(file.name, file.size)
    if (problem) { setErr(problem); return }

    setBusy(true); setErr(null); setDupe(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/invoices/shipments', { method: 'POST', body })
      const d = await readJson<{ shipmentId: string; duplicate: { shipmentId: string; reference: string | null } | null }>(
        res, 'That invoice could not be read.',
      )
      // SHOWN, NEVER USED TO BLOCK. Re-uploading after a failed extraction is legitimate, and the
      // owner is the one who knows which of the two they meant — so the warning holds the navigation
      // rather than the upload.
      if (d.duplicate) { setDupe(d.duplicate); router.refresh(); return }
      router.push(`/v2/bills/${d.shipmentId}`)
    } catch (e) {
      setErr((e as Error).message || 'That invoice could not be read.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={INVOICE_ACCEPT_ATTR}
        className="v2-hidden-file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f) }}
        disabled={busy}
      />
      <button
        type="button"
        className={tone === 'header' ? 'v2-hact' : 'v2-epri'}
        data-tone={tone === 'header' ? 'primary' : undefined}
        data-touch
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        <Upload />{busy ? 'Reading…' : tone === 'header' ? 'Upload' : 'Upload a bill'}
      </button>

      {err && <p className="v2-emsg" data-bad>{err}</p>}
      {dupe && (
        <p className="v2-emsg">
          You have uploaded this one before{dupe.reference ? ` — ${dupe.reference}` : ''}.{' '}
          <a href={`/v2/bills/${dupe.shipmentId}`}>Open the one you already have</a>, or upload a different file.
        </p>
      )}
    </>
  )
}
