import { createAdminClient } from '@/lib/supabase/server'

// ── WHAT THE DATABASE CAN DO TODAY ──────────────────────────────────────────────────────────────
//
// Production's schema deliberately lags the code while add_tg_production_1.sql is applied by hand,
// one part at a time. Every screen that depends on a part has to know whether it is there — and
// the wrong way to know is to try the write and read the error, or to probe a table that may not
// exist from the browser, or to show "run the migration" to a jeweller.
//
// So each part of that migration ends by inserting its own key into `schema_flags`, and this is
// the ONE reader. Server-only, cached per process for a minute, a single cheap query. When the
// flags table itself is absent (nothing applied yet, or a part was run from an older copy of the
// file that had no flag), the fallback is a column/table probe for the parts that HAVE a column —
// with the admin client, on the server, never from a page.
//
// A capability that is false hides or disables exactly the action it gates and nothing else; the
// order, the customer and the board stay fully usable. Nothing here is a user-facing string.

export interface SchemaCapabilities {
  /** Part 1: the 'in_process' stage is in the orders CHECK. Flag only — a CHECK cannot be probed. */
  inProcessStage: boolean
  /** Part 2: payment_allocations knows 'wire', 'etransfer' and paid_on. */
  paymentMethodsExtended: boolean
  /** Part 4: memos, memo_events, catalog ownership + on-memo counters. */
  memos: boolean
  /** Part 5: order_purchases. */
  purchases: boolean
  /** Part 6: orders.order_kind / kind_details. */
  orderKinds: boolean
  /** Part 7: order_approval_requests.request_kind / quoted_cost_cents. */
  vendorQuotation: boolean
  /** Which of the nine parts have their flag. Empty when the flags table does not exist. */
  appliedParts: number[]
  /** How the answer was reached — for the smoke script and the admin, not for the UI. */
  source: 'flags' | 'probe'
}

const NONE: SchemaCapabilities = {
  inProcessStage: false, paymentMethodsExtended: false, memos: false, purchases: false, orderKinds: false, vendorQuotation: false,
  appliedParts: [], source: 'flags',
}

const TTL_MS = 60_000
let cached: { at: number; value: SchemaCapabilities } | null = null

/** Force the next read to hit the database — after the smoke script or an admin applies a part. */
export function resetSchemaCapabilitiesCache(): void { cached = null }

export async function getSchemaCapabilities(): Promise<SchemaCapabilities> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  const value = await read().catch(() => NONE)
  cached = { at: Date.now(), value }
  return value
}

const FLAG_PREFIX = 'tg_production_1.part'

async function read(): Promise<SchemaCapabilities> {
  const db = createAdminClient()
  const { data, error } = await db.from('schema_flags').select('key')
  if (!error) {
    const parts = ((data as Array<{ key: string }> | null) ?? [])
      .map((r) => r.key).filter((k) => k.startsWith(FLAG_PREFIX))
      .map((k) => Number(k.slice(FLAG_PREFIX.length))).filter((n) => Number.isInteger(n))
    const has = (n: number) => parts.includes(n)
    return {
      inProcessStage: has(1), paymentMethodsExtended: has(2), memos: has(4), purchases: has(5), orderKinds: has(6), vendorQuotation: has(7),
      appliedParts: parts.sort((a, b) => a - b), source: 'flags',
    }
  }
  // No flags table: probe the parts that left a column or a table behind. Part 1 cannot be probed
  // and reads as absent, which is the safe answer (the stage stays hidden until the flag exists).
  const probe = async (table: string, column: string) => !(await db.from(table).select(column).limit(1)).error
  const [p2, p4, p5, p6, p7] = await Promise.all([
    probe('payment_allocations', 'paid_on'), probe('memos', 'id'), probe('order_purchases', 'id'), probe('orders', 'order_kind'), probe('order_approval_requests', 'request_kind'),
  ])
  const parts = [p2 && 2, p4 && 4, p5 && 5, p6 && 6, p7 && 7].filter((n): n is number => typeof n === 'number')
  return { inProcessStage: false, paymentMethodsExtended: p2, memos: p4, purchases: p5, orderKinds: p6, vendorQuotation: p7, appliedParts: parts, source: 'probe' }
}

/** The stages the database accepts today — ORDER_STAGES minus the ones a pending part adds. */
export function stageSupported(caps: Pick<SchemaCapabilities, 'inProcessStage'>, stage: string): boolean {
  if (stage === 'in_process') return caps.inProcessStage
  return true
}
