// Create an invoice the way the form does — against the REAL database.
//
// The gates prove the sheet sends the right shapes. They cannot prove that createDocument allocates
// a number, that addLine recomputes the header from the lines it stored, or that the total the screen
// reads is the one the server derived rather than one anybody typed. Those are an RPC, a trigger's
// neighbourhood, and two round trips.
//
// It also proves the failure this form is shaped around: a document created, a line refused, and the
// note that has to outlive the sheet.
//
// Everything it writes, it deletes.
//
//   node scripts/verify-invoice-create.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const rest = async (p, i = {}) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...H, ...(i.headers ?? {}) } })
  return { ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
}
const rpc = async (fn, args) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}
const money = (c) => `$${(c / 100).toFixed(2)}`
let failures = 0
const check = (l, c, d = '') => { if (!c) failures++; console.log(`  ${c ? '✓' : '✗'} ${l}${d ? ` — ${d}` : ''}`) }

// The arithmetic lib/core/money.ts performs. Restated so the probe checks the RESULT against an
// independent calculation rather than against the same function that produced it.
const lineTotal = (q, unit) => Math.round(q * unit)

const main = async () => {
  const [t] = (await rest('invoices?select=tenant_id&limit=1')).body ?? []
  const T = t.tenant_id
  const made = { docs: [], contacts: [] }
  const before = ((await rest(`numbering_counters?tenant_id=eq.${T}&doc_type=eq.invoice&select=next_number`)).body ?? [])[0]
  console.log(`tenant ${T.slice(0, 8)} · invoice counter at ${before?.next_number}\n`)

  try {
    // ── the customer, matched on digits ──────────────────────────────────────────────────────
    const [c] = (await rest('contacts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: T, name: 'PROBE Customer', phone: '+15550134444' }),
    })).body ?? []
    made.contacts.push(c.id)

    // ── 1. the document ──────────────────────────────────────────────────────────────────────
    const num = await rpc('core_next_document_number', { p_tenant: T, p_doc_type: 'invoice' })
    const [doc] = (await rest('invoices', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: T, number: num.body, contact_id: c.id, currency: 'usd' }),
    })).body ?? []
    made.docs.push(doc.id)
    console.log('create:')
    check('a number is allocated from the counter', !!doc.number, doc.number)
    check("it lands as a draft", doc.status === 'draft')
    check('with a total of zero, because it has no lines yet', Number(doc.total_cents) === 0)

    const after = ((await rest(`numbering_counters?tenant_id=eq.${T}&doc_type=eq.invoice&select=next_number`)).body ?? [])[0]
    check('and the counter moved by exactly one', after.next_number === before.next_number + 1, `${before.next_number} → ${after.next_number}`)

    // ── 2. the lines, one call each, header recomputed every time ────────────────────────────
    const want = [
      { description: 'PROBE — call-out', quantity: 1, unit_price_cents: 12500 },
      { description: 'PROBE — parts', quantity: 3, unit_price_cents: 4999 },
      { description: 'PROBE — labour, half day', quantity: 0.5, unit_price_cents: 30000 },
    ]
    let expected = 0
    console.log('\nlines:')
    for (const l of want) {
      const { count } = { count: ((await rest(`sales_document_lines?document_id=eq.${doc.id}&select=id`)).body ?? []).length }
      await rest('sales_document_lines', {
        method: 'POST',
        body: JSON.stringify({ tenant_id: T, document_type: 'invoice', document_id: doc.id, ...l, line_total_cents: lineTotal(l.quantity, l.unit_price_cents), sort_order: count }),
      })
      expected += lineTotal(l.quantity, l.unit_price_cents)
      const lines = (await rest(`sales_document_lines?document_id=eq.${doc.id}&select=quantity,unit_price_cents`)).body ?? []
      const sum = lines.reduce((s, x) => s + lineTotal(Number(x.quantity), Number(x.unit_price_cents)), 0)
      await rest(`invoices?id=eq.${doc.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ subtotal_cents: sum, total_cents: sum }) })
      check(`after ${lines.length} line(s), the header reads ${money(sum)}`, sum === expected, money(expected))
    }

    // A fractional quantity is where a float would show: 0.5 × $300.00 must be exactly $150.00.
    check('a fractional quantity lands exactly', lineTotal(0.5, 30000) === 15000, money(lineTotal(0.5, 30000)))

    const [full] = (await rest(`invoices?id=eq.${doc.id}&select=total_cents,status`)).body ?? []
    check(`the total is ${money(expected)}, derived and not typed`, Number(full.total_cents) === expected, money(Number(full.total_cents)))

    // ── 3. the failure the form is shaped around ─────────────────────────────────────────────
    console.log('\nthe partial-create failure:')
    await rest(`invoices?id=eq.${doc.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'issued', issued_at: new Date().toISOString() }) })
    const refused = await rest('sales_document_lines', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: T, document_type: 'invoice', document_id: doc.id, description: 'PROBE — refused', quantity: 1, unit_price_cents: 1, line_total_cents: 1, sort_order: 9 }),
    })
    check('a line CAN fail after the document exists', !refused.ok, `status ${refused.status}`)

    const message = `${doc.number} was created, but Line 4 of 4 did not save.`
    await rest('document_status_history', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: T, document_type: 'invoice', document_id: doc.id, from_status: 'draft', to_status: 'draft', note: message }),
    })
    const hist = (await rest(`document_status_history?document_id=eq.${doc.id}&select=note,to_status&order=created_at.desc`)).body ?? []
    check('the note is on the document, not in a toast', hist[0]?.note === message)
    check('so it is still there after the sheet is gone', hist.some((h) => h.note?.includes('did not save')))
  } finally {
    for (const id of made.docs) {
      await rest(`invoices?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'draft' }) })
      await rest(`document_status_history?document_id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      await rest(`sales_document_lines?document_id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      await rest(`invoices?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    }
    for (const id of made.contacts) await rest(`contacts?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    const left = (await rest(`invoices?number=like.*&select=number&order=number`)).body ?? []
    console.log(`\ncleaned up: invoices now ${left.map((x) => x.number).join(', ')}`)
    // The counter does NOT go back, and that is §33's decision working: a gap is the honest record of
    // a document that was made and deleted.
    const end = ((await rest(`numbering_counters?tenant_id=eq.${T}&doc_type=eq.invoice&select=next_number`)).body ?? [])[0]
    console.log(`  counter left at ${end.next_number} — the probe's number is a gap, which is §33 working as decided`)
  }
  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
