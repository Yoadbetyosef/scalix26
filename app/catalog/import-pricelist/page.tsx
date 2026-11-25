'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Loader2, Upload } from 'lucide-react'

// IMPORT A SUPPLIER PRICE LIST. Reached by its address, not from the rail: it is used a few times a
// year, by whoever was handed the prepared file. Pick the file, read what it would do, then import.
//
// The file is sent in chunks so a list of several thousand products never rides on one request, and a
// chunk that fails can be sent again — the server skips what is already there.

interface PriceListFile { supplier?: string; currency: string; items: unknown[] }
/** The pictures that go with a price list: small JPEGs, each with the product codes it belongs to. */
interface PictureFile { supplier?: string; images: Array<{ data: string; skus: string[] }> }
interface ChunkResult {
  ok: boolean; error?: string; costColumn: 'cost_primary' | 'cost_secondary' | null
  baseCurrency: string; secondaryCurrency: string | null
  received: number; created: number; skipped: number; variants: number; costs: number
}
type Totals = Pick<ChunkResult, 'created' | 'skipped' | 'variants' | 'costs'>

const CHUNK = 100
const ZERO: Totals = { created: 0, skipped: 0, variants: 0, costs: 0 }

export default function ImportPriceList() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<PriceListFile | null>(null)
  const [fileName, setFileName] = useState('')
  const [check, setCheck] = useState<(Totals & { costColumn: ChunkResult['costColumn']; baseCurrency: string; secondaryCurrency: string | null }) | null>(null)
  const [done, setDone] = useState<Totals | null>(null)
  const [pictures, setPictures] = useState<{ sent: number; updated: number; failed: number } | null>(null)
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null)
  const [busy, setBusy] = useState<'check' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(f: PriceListFile, dryRun: boolean): Promise<(Totals & { last: ChunkResult | null }) | null> {
    const t = { ...ZERO }
    let last: ChunkResult | null = null
    for (let i = 0; i < f.items.length; i += CHUNK) {
      const res = await fetch('/api/catalog/import/pricelist', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currency: f.currency, dryRun, items: f.items.slice(i, i + CHUNK) }),
      })
      const json = await res.json().catch(() => ({})) as ChunkResult
      if (!res.ok || !json.ok) {
        setError(`${json.error ?? 'The server refused that part of the file.'} (stopped at product ${i + 1}; what came before it is saved — importing again continues from here.)`)
        return null
      }
      last = json
      t.created += json.created; t.skipped += json.skipped; t.variants += json.variants; t.costs += json.costs
      setProgress({ sent: Math.min(i + CHUNK, f.items.length), total: f.items.length })
    }
    return { ...t, last }
  }

  async function pick(picked: File) {
    setError(null); setCheck(null); setDone(null); setPictures(null); setProgress(null); setFile(null); setFileName(picked.name)
    let parsed: PriceListFile
    try {
      const raw = JSON.parse(await picked.text()) as Partial<PictureFile> & Partial<PriceListFile>
      if (Array.isArray(raw.images)) { await sendPictures(raw as PictureFile); return }
    } catch { /* not pictures — fall through to the price-list reading below, which reports it */ }
    try {
      parsed = JSON.parse(await picked.text()) as PriceListFile
      if (!parsed || typeof parsed.currency !== 'string' || !Array.isArray(parsed.items) || !parsed.items.length) throw new Error('shape')
    } catch { setError('That file is not a price list we can read.'); return }
    setFile(parsed)
    setBusy('check')
    try {
      const r = await run(parsed, true)
      if (r?.last) setCheck({ created: r.created, skipped: r.skipped, variants: r.variants, costs: r.costs, costColumn: r.last.costColumn, baseCurrency: r.last.baseCurrency, secondaryCurrency: r.last.secondaryCurrency })
    } catch { setError('Could not reach the server. Try again.') } finally { setBusy(null); setProgress(null) }
  }

  // Pictures need no check step: nothing is replaced, only products without a photo get one.
  async function sendPictures(f: PictureFile) {
    setBusy('import')
    let updated = 0, failed = 0
    try {
      for (let i = 0; i < f.images.length; i += 30) {
        const res = await fetch('/api/catalog/import/pricelist-images', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ images: f.images.slice(i, i + 30) }),
        })
        const j = await res.json().catch(() => ({})) as { ok?: boolean; updated?: number; failed?: string[]; error?: string }
        if (!res.ok || !j.ok) { setError(`${j.error ?? 'The server refused that part of the file.'} (stopped at picture ${i + 1}; sending the file again continues.)`); return }
        updated += j.updated ?? 0; failed += j.failed?.length ?? 0
        setProgress({ sent: Math.min(i + 30, f.images.length), total: f.images.length })
      }
      setPictures({ sent: f.images.length, updated, failed })
    } catch { setError('Could not reach the server. Sending the file again continues from where it stopped.') } finally { setBusy(null); setProgress(null) }
  }

  async function importNow() {
    if (!file) return
    setError(null); setBusy('import')
    try {
      const r = await run(file, false)
      if (r) { setDone({ created: r.created, skipped: r.skipped, variants: r.variants, costs: r.costs }); setCheck(null) }
    } catch { setError('Could not reach the server. Importing again continues from where it stopped.') } finally { setBusy(null) }
  }

  const n = (x: number) => x.toLocaleString()
  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Import a supplier price list</p>
        <s />
        <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
          <Upload className="w-3.5 h-3.5" /> Choose file
        </button>
      </div>
      <input
        ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = '' }}
      />

      {busy && (
        <p className="v2-kick mt-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy === 'check' ? 'Reading your file…' : 'Importing…'}
          {progress ? ` ${n(progress.sent)} of ${n(progress.total)}` : ''}
        </p>
      )}

      {error && (
        <div className="v2-notice mt-3" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
          <span className="v2-chip-sq"><AlertCircle /></span>
          <p>{error}</p>
        </div>
      )}

      {check && !busy && (
        <div className="mt-4">
          <p className="text-sm text-ink">
            <b>{fileName}</b> — {file?.supplier ? `${file.supplier}, ` : ''}prices in {file?.currency}.
          </p>
          <p className="mt-2 text-sm text-muted">
            {n(check.created)} new products{check.variants ? `, ${n(check.variants)} sub-products` : ''}, {n(check.costs)} costs.
            {check.skipped ? ` ${n(check.skipped)} are already in the catalog and will be left as they are.` : ''}
          </p>
          <p className="mt-2 text-sm text-muted">
            {check.costColumn === 'cost_primary' && `Prices go in as cost, in ${check.baseCurrency}.`}
            {check.costColumn === 'cost_secondary' && `Prices go in as the supplier's cost in ${check.secondaryCurrency}. The cost in ${check.baseCurrency} stays empty until it is entered — nothing is converted.`}
            {check.costColumn === null && `This business's cost settings use ${check.baseCurrency}${check.secondaryCurrency ? ` and ${check.secondaryCurrency}` : ''}, not ${file?.currency}. Set ${file?.currency} as the second currency in cost settings, then choose the file again.`}
          </p>
          {check.costColumn !== null && check.created > 0 && (
            <button onClick={() => void importNow()} className="v2-act tap-target mt-4" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
              <Upload className="w-3.5 h-3.5" /> Import {n(check.created)} products
            </button>
          )}
        </div>
      )}

      {pictures && !busy && (
        <p className="mt-4 text-sm text-ink">
          {fileName}: {n(pictures.sent)} pictures sent, {n(pictures.updated)} products now have a photo.
          {pictures.failed ? ` ${n(pictures.failed)} could not be stored.` : ''}{' '}
          <Link href="/catalog" className="underline">Open the catalog</Link>
        </p>
      )}

      {done && !busy && (
        <p className="mt-4 text-sm text-ink">
          Imported {n(done.created)} products{done.variants ? `, ${n(done.variants)} sub-products` : ''} and {n(done.costs)} costs.
          {done.skipped ? ` ${n(done.skipped)} were already there.` : ''}{' '}
          <Link href="/catalog" className="underline">Open the catalog</Link>
        </p>
      )}
    </div>
  )
}
