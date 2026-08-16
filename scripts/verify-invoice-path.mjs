// Issue an invoice, record a partial payment, read the balance back — against the REAL database.
//
// The $100 deposit on INV-0001 already proved the RPC in isolation. This proves the PATH: that
// issuing stamps a date and a due date and the payment snapshot, that the freeze trigger actually
// bites, that a partial leaves the right balance, and that the status derives to `partial` rather
// than to paid or unpaid.
//
// None of that is provable by the gates. The trigger is Postgres, the derivation is an RPC, and the
// snapshot is a column read at one moment and never again.
//
// Everything it writes, it undoes: the invoice goes back to draft, the payment is deleted, and the
// settings row is restored to whatever was there before (usually nothing).
//
//   node scripts/verify-invoice-path.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const rest = async (path, init = {}) => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}
const rpc = async (fn, args) => {
  const res = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
}

const NUMBER = 'INV-0002'
const money = (c) => `$${(c / 100).toFixed(2)}`
let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const main = async () => {
  const [inv] = (await rest(`invoices?number=eq.${NUMBER}&select=*`)).body ?? []
  if (!inv) throw new Error(`${NUMBER} not found`)
  const T = inv.tenant_id
  const restoreSettings = ((await rest(`invoice_settings?tenant_id=eq.${T}&select=*`)).body ?? [])[0] ?? null
  console.log(`${NUMBER} · tenant ${T.slice(0, 8)} · total ${money(inv.total_cents)} · status ${inv.status}\n`)

  const lines = (await rest(`sales_document_lines?document_type=eq.invoice&document_id=eq.${inv.id}&select=id,description,line_total_cents`)).body ?? []
  check('it has lines to issue', lines.length > 0, `${lines.length}`)

  try {
    // ── Payment details, so the snapshot has something to copy ───────────────────────────────
    const INSTRUCTIONS = 'PROBE — Zelle: pay@example.com\nBank transfer: Chase ••4021, routing 021000021'
    await rest('invoice_settings', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ tenant_id: T, payment_instructions: INSTRUCTIONS, net_days: 14 }),
    })

    // ── 1. ISSUE ─────────────────────────────────────────────────────────────────────────────
    const issuedAt = new Date().toISOString()
    const due = new Date(issuedAt); due.setUTCDate(due.getUTCDate() + 14)
    const issued = await rest(`invoices?id=eq.${inv.id}&status=eq.draft`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'issued', issued_at: issuedAt, updated_at: issuedAt,
        due_on: due.toISOString().slice(0, 10), payment_instructions: INSTRUCTIONS,
      }),
    })
    const doc = (issued.body ?? [])[0]
    console.log('\nissue:')
    check('draft → issued', doc?.status === 'issued')
    check('the date is stamped', !!doc?.issued_at, doc?.issued_at?.slice(0, 19))
    check('the due date is stamped 14 days out', doc?.due_on === due.toISOString().slice(0, 10), doc?.due_on)
    check('the payment details are SNAPSHOTTED onto the invoice', doc?.payment_instructions === INSTRUCTIONS)
    check('the number is unchanged', doc?.number === NUMBER, doc?.number)

    // Issuing again must find nothing — the status is in the WHERE clause.
    const again = await rest(`invoices?id=eq.${inv.id}&status=eq.draft`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'issued' }),
    })
    check('issuing twice moves nothing', (again.body ?? []).length === 0)

    // ── 2. THE FREEZE ────────────────────────────────────────────────────────────────────────
    console.log('\nthe freeze:')
    const addLine = await rest('sales_document_lines', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: T, document_type: 'invoice', document_id: inv.id,
        description: 'PROBE — should never land', quantity: 1, unit_price_cents: 1, line_total_cents: 1, sort_order: 99,
      }),
    })
    check('a new line is REFUSED by the database', !addLine.ok, `status ${addLine.status}`)
    check('and it says why', JSON.stringify(addLine.body ?? '').includes('document_not_draft'))

    const delLine = await rest(`sales_document_lines?id=eq.${lines[0].id}`, { method: 'DELETE' })
    check('deleting an existing line is refused too', !delLine.ok, `status ${delLine.status}`)

    const stillThere = (await rest(`sales_document_lines?document_id=eq.${inv.id}&select=id`)).body ?? []
    check('so the total cannot have moved', stillThere.length === lines.length, `${stillThere.length} lines`)

    // ── 3. A PARTIAL PAYMENT ─────────────────────────────────────────────────────────────────
    const part = Math.floor(inv.total_cents / 3)
    const key = `probe:${inv.id}:${issuedAt}`
    const paid = await rpc('core_apply_payment', {
      p_tenant: T, p_doc_type: 'invoice', p_doc_id: inv.id, p_kind: 'deposit',
      p_amount_cents: part, p_currency: 'usd', p_provider_ref: 'PROBE-8841', p_key: key,
      p_actor: null, p_method: 'transfer',
    })
    console.log('\na partial payment:')
    check('the RPC accepts a method', paid.body?.ok === true, JSON.stringify(paid.body))
    check(`paid is ${money(part)}`, Number(paid.body?.paid_cents) === part, money(Number(paid.body?.paid_cents ?? 0)))
    check(`balance is ${money(inv.total_cents - part)}`, Number(paid.body?.balance_cents) === inv.total_cents - part)
    check("status derives to 'partial', not paid and not unpaid", paid.body?.status === 'partial', paid.body?.status)

    const [alloc] = (await rest(`payment_allocations?idempotency_key=eq.${encodeURIComponent(key)}&select=*`)).body ?? []
    check('the method is stored on the row', alloc?.method === 'transfer', alloc?.method)
    check('and so is the reference', alloc?.provider_ref === 'PROBE-8841')

    const twice = await rpc('core_apply_payment', {
      p_tenant: T, p_doc_type: 'invoice', p_doc_id: inv.id, p_kind: 'deposit',
      p_amount_cents: part, p_currency: 'usd', p_provider_ref: 'PROBE-8841', p_key: key,
      p_actor: null, p_method: 'transfer',
    })
    check('recording it twice is idempotent', twice.body?.idempotent === true)
    // Scoped to THIS invoice, so one is the whole answer: the retry added nothing. INV-0001's $100
    // deposit is on a different document and never enters this count.
    const all = (await rest(`payment_allocations?document_id=eq.${inv.id}&select=id`)).body ?? []
    check('and left one payment, not two', all.length === 1, `${all.length} on ${NUMBER}`)

    // ── 4. READ IT BACK ──────────────────────────────────────────────────────────────────────
    const [after] = (await rest(`invoices?id=eq.${inv.id}&select=total_cents,status,due_on`)).body ?? []
    const allocs = (await rest(`payment_allocations?document_id=eq.${inv.id}&select=amount_cents`)).body ?? []
    const sum = allocs.reduce((s, a) => s + Number(a.amount_cents), 0)
    console.log('\nread back, the way the screen reads it:')
    check(`total ${money(after.total_cents)}`, Number(after.total_cents) === inv.total_cents)
    check(`received ${money(sum)}`, sum === part)
    check(`still due ${money(after.total_cents - sum)}`, after.total_cents - sum === inv.total_cents - part)
    check('and it is not overdue — the due date is in the future', after.due_on > new Date().toISOString().slice(0, 10), after.due_on)
  } finally {
    console.log('\nundoing:')
    await rest(`payment_allocations?document_id=eq.${inv.id}&idempotency_key=like.probe:*`, { method: 'DELETE' })
    const left = (await rest(`payment_allocations?document_id=eq.${inv.id}&select=id`)).body ?? []
    // Back to draft LAST: the freeze blocks nothing on a payment, but the invoice must not be left
    // issued with a probe's date on it.
    await rest(`invoices?id=eq.${inv.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'draft', issued_at: null, due_on: null, payment_instructions: null }),
    })
    if (restoreSettings) {
      await rest(`invoice_settings?tenant_id=eq.${T}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(restoreSettings) })
    } else {
      await rest(`invoice_settings?tenant_id=eq.${T}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    }
    const [back] = (await rest(`invoices?id=eq.${inv.id}&select=status,issued_at,due_on,payment_instructions`)).body ?? []
    const restored = back.status === 'draft' && !back.issued_at && !back.due_on && !back.payment_instructions
    console.log(`  ${restored ? '✓' : '✗'} ${NUMBER} is a draft again, with no date and no snapshot`)
    console.log(`  ${left.length === 0 ? '✓' : '✗'} probe payments removed (${left.length} left)`)
    if (!restored || left.length) failures++
  }

  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
