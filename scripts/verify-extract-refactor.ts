// Does the refactored extractInvoice still read a REAL supplier invoice the same way?
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
//
// The document turn, the streaming, the structured-output call, the metering and the narrowing of the
// response moved out of lib/invoices/extract.ts into lib/anthropic/read-document.ts so a second
// reader — receipts — could use them. That refactor touches the ONE path in this application where a
// misread digit is invisible: a wrong unit price becomes a wrong landed cost, becomes a wrong retail
// price, and nothing downstream ever contradicts it.
//
// extract.test.ts pins pageCountOf and nothing else, because everything else in that file was a live
// API call. So the guard for this change is not a fixture — a fixture would only prove the refactor
// is self-consistent with a file I wrote to suit it. It is the two real invoices this feature has
// actually processed, re-read with the new code and compared against what the old code stored.
//
//   node_modules/.bin/tsx scripts/verify-extract-refactor.ts [--invoice <id>]
//
// ── WHAT A DIFFERENCE MEANS ─────────────────────────────────────────────────────────────────────
//
// The model is not deterministic, so a run is not expected to be byte-identical. Read it this way:
//
//   identity + money    supplier, number, date, currency, subtotal, totals. These are TRANSCRIBED
//                       from the page. A difference here is a real finding — either the refactor
//                       broke something, or the extraction was never as stable as it looked.
//   line count          a difference is worth reading before it is worth worrying about; the stored
//                       lines are the ones that survived, and a person can have deleted some.
//   line contents       stored lines are EDITABLE after extraction. A description that differs may be
//                       somebody's correction rather than a regression. Compared anyway, and reported
//                       as "differs", not as "wrong".
//
// The tenant id passed to extractInvoice is deliberately EMPTY. trackLlm returns early without one,
// so this script's spend does not land on the tenant's meter — they did not ask for this run, and on
// a White Label workspace it would be billable to their partner.

import { readFileSync } from 'node:fs'
import type { ExtractedLine } from '../lib/invoices/extract'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
// BEFORE the repo modules load, not after: lib/anthropic/client.ts constructs its client at import
// time from process.env, and a static import would have been hoisted above this line.
process.env.ANTHROPIC_API_KEY ||= env.ANTHROPIC_API_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const repo = async () => ({
  ...(await import('../lib/invoices/extract')),
  ...(await import('../lib/invoices/store')),
  ...(await import('../lib/cost/rates')),
})
type Repo = Awaited<ReturnType<typeof repo>>

const only = process.argv.includes('--invoice') ? process.argv[process.argv.indexOf('--invoice') + 1] : null

interface StoredInvoice {
  id: string; tenant_id: string; storage_path: string; file_name: string; mime_type: string
  supplier_name: string | null; invoice_number: string | null; invoice_date: string | null
  currency: string | null; subtotal: number | null; tax_total: number | null; grand_total: number | null
  extracted_freight: number | null; extracted_duties: number | null; extracted_other: number | null
  page_count: number | null; extraction_model: string | null
  extraction_input_tokens: number | null; extraction_output_tokens: number | null
}
interface StoredLine {
  line_no: number; description: string | null; sku: string | null
  quantity: number | null; unit_price: number | null; extended: number | null
}

const rest = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2))
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
const close = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 0.005

function mark(ok: boolean) { return ok ? '  ok  ' : ' DIFF ' }

async function run(lib: Repo, inv: StoredInvoice) {
  const lines = await rest<StoredLine[]>(
    `supplier_invoice_lines?invoice_id=eq.${inv.id}&select=line_no,description,sku,quantity,unit_price,extended&order=line_no.asc`,
  )

  console.log(`\n${'═'.repeat(78)}`)
  console.log(`${inv.file_name}`)
  console.log(`  stored: ${inv.supplier_name} · ${inv.invoice_number} · ${inv.page_count} pages · ${lines.length} lines kept`)
  console.log(`  ${inv.extraction_model}, ${inv.extraction_input_tokens} in / ${inv.extraction_output_tokens} out`)

  const dl = await fetch(`${SB}/storage/v1/object/${lib.INVOICE_BUCKET}/${inv.storage_path}`, { headers: H })
  if (!dl.ok) throw new Error(`download ${dl.status}`)
  const bytes = Buffer.from(await dl.arrayBuffer())
  console.log(`  downloaded ${(bytes.length / 1024).toFixed(0)} KB`)

  const started = Date.now()
  // Empty tenant id on purpose — see the header.
  const r = await lib.extractInvoice('', bytes, inv.mime_type, inv.currency || 'USD')
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  const got = r.invoice

  console.log(`  re-read in ${secs}s — ${r.inputTokens} in / ${r.outputTokens} out, ` +
    `$${lib.llmCost(r.model, r.inputTokens, r.outputTokens).toFixed(4)}\n`)

  const rows: [string, boolean, string, string][] = [
    ['supplier',    same(got.supplierName, inv.supplier_name),   String(inv.supplier_name), String(got.supplierName)],
    ['number',      same(got.invoiceNumber, inv.invoice_number), String(inv.invoice_number), String(got.invoiceNumber)],
    ['date',        same(got.invoiceDate, inv.invoice_date),     String(inv.invoice_date), String(got.invoiceDate)],
    ['currency',    same(got.currency, inv.currency),            String(inv.currency), String(got.currency)],
    ['subtotal',    close(got.subtotal, inv.subtotal),           n(inv.subtotal), n(got.subtotal)],
    ['tax',         close(got.taxTotal, inv.tax_total),          n(inv.tax_total), n(got.taxTotal)],
    ['grand total', close(got.grandTotal, inv.grand_total),      n(inv.grand_total), n(got.grandTotal)],
    ['freight',     close(got.freightTotal, inv.extracted_freight), n(inv.extracted_freight), n(got.freightTotal)],
    ['duties',      close(got.dutiesTotal, inv.extracted_duties),   n(inv.extracted_duties), n(got.dutiesTotal)],
    ['other',       close(got.otherTotal, inv.extracted_other),     n(inv.extracted_other), n(got.otherTotal)],
    ['page count',  r.pageCount === inv.page_count,              String(inv.page_count), String(r.pageCount)],
    ['line count',  got.lines.length === lines.length,           String(lines.length), String(got.lines.length)],
  ]
  console.log('  FIELD          STORED                          RE-READ')
  for (const [label, ok, was, now] of rows) {
    console.log(`${mark(ok)} ${label.padEnd(13)} ${was.slice(0, 30).padEnd(31)} ${now.slice(0, 30)}`)
  }

  // Lines, matched by position after sorting both the same way. Stored rows keep their line_no from
  // the original extraction, so position is the only thing the two runs share.
  let lineDiffs = 0
  const width = Math.min(lines.length, got.lines.length)
  for (let i = 0; i < width; i++) {
    const was = lines[i]
    const now: ExtractedLine = got.lines[i]
    const problems: string[] = []
    if (!same(was.sku, now.sku)) problems.push(`sku ${was.sku} → ${now.sku}`)
    if (!same(was.description, now.description)) problems.push(`desc "${was.description}" → "${now.description}"`)
    if (!close(was.quantity, now.quantity)) problems.push(`qty ${n(was.quantity)} → ${n(now.quantity)}`)
    if (!close(was.unit_price, now.unitPrice)) problems.push(`unit ${n(was.unit_price)} → ${n(now.unitPrice)}`)
    if (!close(was.extended, now.lineTotal)) problems.push(`total ${n(was.extended)} → ${n(now.lineTotal)}`)
    if (problems.length) {
      lineDiffs++
      console.log(`  line ${String(was.line_no).padStart(3)}  ${problems.join('; ')}`)
    }
  }
  console.log(`\n  lines compared: ${width}, differing: ${lineDiffs}`)

  // The sum the allocation actually weights on. If this agrees, every product's landed cost lands in
  // the same place regardless of how a single description was spelled.
  const sumNow = got.lines.reduce((s, l) => s + (l.lineTotal ?? (l.quantity ?? 0) * (l.unitPrice ?? 0)), 0)
  const sumWas = lines.reduce((s, l) => s + (l.extended ?? 0), 0)
  console.log(`  extended sum: stored ${sumWas.toFixed(2)} · re-read ${sumNow.toFixed(2)} ` +
    `${close(Number(sumWas.toFixed(2)), Number(sumNow.toFixed(2))) ? '(same)' : '(DIFFERS)'}`)
}

async function main() {
  const filter = only ? `&id=eq.${only}` : ''
  const invoices = await rest<StoredInvoice[]>(
    `supplier_invoices?select=*&order=created_at.desc${filter}`,
  )
  console.log(`${invoices.length} real supplier invoice(s) on file.`)
  const lib = await repo()
  for (const inv of invoices) await run(lib, inv)
}

main().catch((e) => { console.error(e); process.exit(1) })
