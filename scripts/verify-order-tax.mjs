// The tax snapshot, against TG jewellers' REAL orders.
//
// Everything it writes, it undoes. It picks the order with the LOWEST subtotal that already has a
// delivery province, so the numbers stay small and recognisable if anything is left behind.
//
// What the gates cannot see: whether the columns exist, whether the three CHECK constraints actually
// bite, and whether her existing orders still read the way they did before the migration ran.
//
//   node scripts/verify-order-tax.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const T = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'

const rest = async (p, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  return { ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
}
let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const money = (c) => `$${(c / 100).toFixed(2)}`

const main = async () => {
  const all = (await rest(`orders?tenant_id=eq.${T}&select=id,order_number,subtotal_cents,delivery_province,tax_kind,tax_label,tax_rate_percent,pst_exempt,pst_exemption_note&order=subtotal_cents`)).body ?? []
  console.log(`${all.length} orders on TG jewellers\n`)

  // ── 1. THE MIGRATION LANDED, AND CHANGED NOTHING ─────────────────────────────────────────
  console.log('after the migration:')
  check('every order has pst_exempt = false', all.every((o) => o.pst_exempt === false))
  check('and NOT ONE has a snapshot', all.every((o) => o.tax_label === null && o.tax_rate_percent === null))
  const withProv = all.filter((o) => o.delivery_province)
  check('her three orders with a province still have it', withProv.length === 3,
    withProv.map((o) => o.delivery_province).sort().join(', '))
  // Those render through the live fallback, exactly as before. Nothing was backfilled.
  check('and none of the three gained a kind', withProv.every((o) => o.tax_kind === null))

  const target = all.find((o) => o.delivery_province && Number(o.subtotal_cents) > 0) ?? all.find((o) => Number(o.subtotal_cents) > 0)
  if (!target) throw new Error('no order with a subtotal to probe')
  const before = { ...target }
  console.log(`\nprobing ${target.order_number} · subtotal ${money(target.subtotal_cents)} · province ${target.delivery_province ?? 'none'}\n`)

  try {
    // ── 2. THE CONSTRAINTS ────────────────────────────────────────────────────────────────
    console.log('the constraints:')
    const halfA = await rest(`orders?id=eq.${target.id}`, { method: 'PATCH', body: JSON.stringify({ tax_label: 'GST' }) })
    check('a label with no rate is REFUSED', !halfA.ok, `status ${halfA.status}`)
    check('and it names the constraint', JSON.stringify(halfA.body ?? '').includes('orders_tax_snapshot_whole'))

    const halfB = await rest(`orders?id=eq.${target.id}`, { method: 'PATCH', body: JSON.stringify({ tax_rate_percent: 5 }) })
    check('a rate with no label is refused too', !halfB.ok, `status ${halfB.status}`)

    const badKind = await rest(`orders?id=eq.${target.id}`, { method: 'PATCH', body: JSON.stringify({ tax_kind: 'wholesale' }) })
    check("tax_kind 'wholesale' is refused — it names a customer, not a rate", !badKind.ok, `status ${badKind.status}`)

    const negative = await rest(`orders?id=eq.${target.id}`, { method: 'PATCH', body: JSON.stringify({ tax_label: 'GST', tax_rate_percent: -1 }) })
    check('a negative rate is refused', !negative.ok, `status ${negative.status}`)

    // ── 3. BOTH BC READINGS, ON THE SAME ORDER ────────────────────────────────────────────
    console.log('\nthe two correct answers for one province:')
    for (const [kind, label, rate] of [['combined', 'GST + PST', 12], ['gst_only', 'GST', 5]]) {
      const w = await rest(`orders?id=eq.${target.id}&select=*`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ delivery_province: 'BC', tax_kind: kind, tax_label: label, tax_rate_percent: rate }),
      })
      const row = (w.body ?? [])[0]
      const amount = Math.round((Number(target.subtotal_cents) * rate) / 100)
      check(`BC · ${label} ${rate}% stores whole`,
        row?.tax_kind === kind && row?.tax_label === label && Number(row?.tax_rate_percent) === rate,
        `tax on ${money(target.subtotal_cents)} = ${money(amount)}`)
    }
    // 14.975 is the value that needs numeric(6,3); a column with fewer decimals would round it here.
    const qc = await rest(`orders?id=eq.${target.id}&select=tax_rate_percent`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tax_label: 'GST + QST', tax_rate_percent: 14.975 }),
    })
    check('14.975 survives the column exactly', Number((qc.body ?? [])[0]?.tax_rate_percent) === 14.975,
      String((qc.body ?? [])[0]?.tax_rate_percent))

    // ── 4. THE EXEMPTION IS A CLAIM ───────────────────────────────────────────────────────
    console.log('\nthe exemption:')
    const ex = await rest(`orders?id=eq.${target.id}&select=pst_exempt,pst_exemption_note`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ pst_exempt: true, pst_exemption_note: 'PROBE — PST exempt, resale certificate on file' }),
    })
    const row = (ex.body ?? [])[0]
    check('the assertion and its sentence both store', row?.pst_exempt === true && !!row?.pst_exemption_note)
    // Unticking must leave the text alone: the claim is removed from the document, not destroyed.
    const untick = await rest(`orders?id=eq.${target.id}&select=pst_exempt,pst_exemption_note`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ pst_exempt: false }),
    })
    const u = (untick.body ?? [])[0]
    check('unticking keeps the text but withdraws the claim', u?.pst_exempt === false && !!u?.pst_exemption_note)
  } finally {
    console.log('\nundoing:')
    await rest(`orders?id=eq.${target.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        delivery_province: before.delivery_province, tax_kind: before.tax_kind,
        tax_label: before.tax_label, tax_rate_percent: before.tax_rate_percent,
        pst_exempt: before.pst_exempt, pst_exemption_note: before.pst_exemption_note,
      }),
    })
    const [back] = (await rest(`orders?id=eq.${target.id}&select=delivery_province,tax_kind,tax_label,tax_rate_percent,pst_exempt,pst_exemption_note`)).body ?? []
    const same = back.delivery_province === before.delivery_province && back.tax_kind === before.tax_kind
      && back.tax_label === before.tax_label && back.tax_rate_percent === before.tax_rate_percent
      && back.pst_exempt === before.pst_exempt && back.pst_exemption_note === before.pst_exemption_note
    console.log(`  ${same ? '✓' : '✗'} ${target.order_number} is exactly as it was — province ${back.delivery_province ?? 'none'}, no snapshot, not exempt`)
    if (!same) failures++
  }

  // ── 5. tax_rates IS UNTOUCHED ───────────────────────────────────────────────────────────
  const rates = (await rest('tax_rates?select=region,rate_percent&order=region')).body ?? []
  console.log('\nthe statutory table:')
  check('still 14 rows, still the reference', rates.length === 14, `${rates.length} rows`)
  check('BC is still 12% there — the picker did not rewrite it', Number(rates.find((r) => r.region === 'BC')?.rate_percent) === 12)

  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
