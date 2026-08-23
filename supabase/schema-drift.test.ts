import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// THE FOLDER DOES NOT DESCRIBE THE DATABASE, and this is the assertion that stops that getting worse
// without anybody noticing.
//
// Measured 22 Aug 2026: 221 relations live, 144 declared by supabase/migrations, 78 tables in
// production that no CREATE TABLE anywhere creates — the twelve founding tables, 28 commerce_*, the
// inventory set, and thirty core/proposal/workflow tables run by hand off branches that never merged.
// One of them, sales_document_lines, carries a trigger created by a migration that IS on main, so
// main already stands on schema main does not own.
//
// ── WHY A COMMITTED INVENTORY AND NOT A LIVE CHECK ──────────────────────────────────────────────────
//
// Detecting drift needs the database, and the database needs a service key a test run has no business
// holding. So it is split the way this repo already splits it — scripts/verify-schema-drift.mjs hits
// production and is run by a person; this asserts the committed inventory and the folder still agree,
// and runs anywhere. Regenerating the inventory is what makes new drift visible, and this is what
// makes regenerating it honest.
//
// The precedent is public-routes.test.ts, which exists because that list drifted too.

const ROOT = process.cwd()
const inventory = JSON.parse(readFileSync(join(ROOT, 'supabase/schema-inventory.json'), 'utf8')) as {
  takenAt: string
  liveRelations: string[]
  declaredNowhere: string[]
  declaredButAbsent: string[]
}

/** The same parse the script does. Duplicated deliberately — see the note in the last test. */
const strip = (sql: string) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/'(?:[^']|'')*'/g, "''")

function declared(): Set<string> {
  const out = new Set<string>()
  const dir = join(ROOT, 'supabase/migrations')
  // supabase/schema.sql declares too — the hand-written founding schema, and where tenants, contacts,
  // conversations and six others come from. Reading only the folder reported those nine as created by
  // nothing, which was this check's own first false positive.
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => join(dir, f)), join(ROOT, 'supabase/schema.sql')]
  for (const f of files) {
    const sql = strip(readFileSync(f, 'utf8'))
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_0-9]+)/gi)) out.add(m[1])
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+([a-z_0-9]+)/gi)) out.add(m[1])
  }
  return out
}
const NOT_PUBLISHED = new Set(['referral_clicks_default'])

describe('the migrations folder against the recorded database', () => {
  it('declares nothing that is not there', () => {
    // This is the direction that would break a deploy: a migration naming a table production lacks.
    expect(inventory.declaredButAbsent).toEqual([])
  })

  it('still fails to describe exactly the tables it failed to describe when this was measured', () => {
    // NOT a count. A count would pass while one orphan was swapped for another, and the whole point
    // is to notice a NEW table appearing in production with nothing behind it.
    const live = new Set(inventory.liveRelations)
    const dec = declared()
    const orphansNow = inventory.liveRelations.filter((t) => !dec.has(t))
    expect(orphansNow).toEqual(inventory.declaredNowhere)
    expect(live.size).toBe(inventory.liveRelations.length)
  })

  it('names the ones that matter, so nobody has to rediscover them', () => {
    const o = new Set(inventory.declaredNowhere)
    // Main's add_document_freeze.sql puts trg_lines_only_on_draft on this table, and no migration in
    // this folder creates it. That is the sharpest edge of the drift.
    expect(o.has('sales_document_lines')).toBe(true)
    // NOT the founding tables — supabase/schema.sql declares those, and reading only the migrations
    // folder is what wrongly reported nine of them as created by nothing.
    for (const t of ['tenants', 'contacts', 'conversations', 'ai_employees']) expect(o.has(t)).toBe(false)
    // The commerce module, whose own migration says "Depends on migrations 1–7" — migrations nobody
    // in this repository can read.
    expect(inventory.declaredNowhere.filter((t) => t.startsWith('commerce_')).length).toBeGreaterThan(20)
  })

  it('is dated, because an inventory without a date is a claim about now', () => {
    expect(inventory.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('parses the folder the same way the script does', () => {
    // The two parsers are duplicated rather than shared: the script imports nothing from the app and
    // reads .env.local, and pulling it into a test would drag a service key into the test run. What
    // protects the copy is this — both must find the same set, or the committed inventory is being
    // compared against a different reading of the folder than the one that produced it.
    const src = readFileSync(join(ROOT, 'scripts/verify-schema-drift.mjs'), 'utf8')
    expect(src).toContain("CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([a-z_0-9]+)")
    expect(src).toContain("'(?:[^']|'')*'")
    for (const t of NOT_PUBLISHED) expect(src).toContain(t)
  })
})
