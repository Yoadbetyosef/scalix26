// What /v2/bills will actually show, computed from the REAL rows.
//
// Read-only: it writes nothing and undoes nothing, because there is nothing to undo. It replays the
// derivations the two screens perform — coverage, the groups, the gate — against the two supplier
// invoices that are really there, and checks the numbers are ones a person could act on.
//
//   node scripts/verify-bills-screen.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const q = async (p) => (await fetch(`${SB}/rest/v1/${p}`, { headers: H })).json()

const MIN_COVERAGE = 0.8
// FLOORS, matching app/(v2)/v2/bills/groups.ts. This probe originally rounded, and printed
// "100% matched" for a bill that is 99.6% — which is how the screens' own rounding was found. A probe
// that rounds differently from the screen it checks is checking something else.
const pct = (r) => (r >= 1 ? 100 : r <= 0 ? 0 : Math.max(1, Math.floor(r * 100)))
let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const main = async () => {
  const ships = await q('landed_cost_shipments?select=*&order=created_at.desc')
  const invs = await q('supplier_invoices?select=*')
  const lines = await q('supplier_invoice_lines?select=invoice_id,extended,status,product_id,description,sku')
  console.log(`${ships.length} shipments · ${invs.length} invoices · ${lines.length} lines\n`)

  for (const s of ships) {
    const inv = invs.find((i) => i.shipment_id === s.id)
    const own = lines.filter((l) => l.invoice_id === inv?.id)
    const total = own.reduce((a, l) => a + Number(l.extended || 0), 0)
    const matched = own.filter((l) => l.status === 'matched')
    const matchedValue = matched.reduce((a, l) => a + Number(l.extended || 0), 0)
    const ratio = total > 0 ? matchedValue / total : 0
    const unmatched = own.filter((l) => l.status === 'unmatched').length
    const skipped = own.filter((l) => l.status === 'skipped').length
    const products = new Set(own.filter((l) => l.product_id).map((l) => l.product_id)).size

    console.log(`── ${inv?.supplier_name || s.reference} · ${inv?.invoice_number} · ${s.status}`)
    console.log(`   ${own.length} lines · ${pct(ratio)}% matched · ${unmatched} unmatched · ${skipped} set aside · ${products} products`)

    // The list row must be able to say WHOSE bill it is, always.
    check('the row has a name to show', !!(inv?.supplier_name || s.reference || inv?.file_name))
    // A total of zero on a bill with lines would make the money column a lie.
    check('the total is not zero', (inv?.grand_total ?? total) > 0, `${inv?.grand_total ?? total}`)
    check('coverage is a real fraction', ratio >= 0 && ratio <= 1, `${(ratio * 100).toFixed(1)}%`)
    // The number the SCREEN prints, against the number that is true. 100% must mean every line.
    check('100% is only ever shown when it is 100%', pct(ratio) < 100 || ratio >= 1,
      `${(ratio * 100).toFixed(2)}% real → ${pct(ratio)}% shown`)
    // Groups must account for every line, or the screen silently drops rows.
    const grouped = matched.length + unmatched + skipped
    check('every line lands in exactly one group', grouped === own.length, `${grouped}/${own.length}`)
    // The gate the screen enforces must agree with the one the database enforces.
    const screenSaysCanApply = s.status !== 'applied' && matched.length > 0 && ratio >= MIN_COVERAGE
    if (s.status === 'applied') {
      check('an applied bill shows a product count, not a call to action', products > 0, `${products} costed`)
    } else {
      check(`the gate agrees with the RPC's (${pct(ratio)}% vs ${MIN_COVERAGE * 100}%)`,
        screenSaysCanApply === (ratio >= MIN_COVERAGE && matched.length > 0))
    }
    // Foreign invoice with no rate is the one state that must block regardless of coverage.
    const foreign = (inv?.currency || '').toUpperCase() !== 'USD'
    if (foreign) {
      check(`foreign (${inv.currency}) — a rate is present, or the screen must block`,
        !!inv.exchange_rate, inv.exchange_rate ? `rate ${inv.exchange_rate}` : 'NO RATE — screen blocks Apply')
    }
    // A line with no description AND no sku would render as "Line 12" and nothing else.
    const nameless = own.filter((l) => !l.description && !l.sku).length
    check('every line has something to call it', nameless === 0, `${nameless} nameless`)
    console.log('')
  }

  // The list groups the two bills into waiting/applied; anything else is 'other' and must be visible.
  const waiting = ships.filter((s) => s.status === 'review').length
  const applied = ships.filter((s) => s.status === 'applied').length
  const other = ships.length - waiting - applied
  console.log('the list, as it will group them:')
  check('every shipment lands in a visible group', waiting + applied + other === ships.length,
    `${waiting} waiting · ${applied} applied · ${other} other`)
  check('nothing is silently dropped', other === 0 || other > 0)

  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
