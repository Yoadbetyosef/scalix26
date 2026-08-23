// DOES supabase/migrations DESCRIBE THE DATABASE? Almost certainly not, and this says by how much.
//
// Read-only. It writes nothing anywhere: it reads the relation list PostgREST publishes, reads every
// CREATE TABLE / CREATE VIEW out of the migrations folder, and prints the two ways they disagree.
//
//   node scripts/verify-schema-drift.mjs            # report
//   node scripts/verify-schema-drift.mjs --write    # also refresh supabase/schema-inventory.json
//
// ── WHY THIS IS A SCRIPT AND schema-drift.test.ts IS A TEST ─────────────────────────────────────────
//
// Detecting drift needs the database, and the database needs a service key, which a test run has no
// business holding. So the halves are split the way the repo already splits them: this hits
// production and is run by a person; the test asserts the committed inventory and the folder still
// agree with each other, and runs anywhere.
//
// Neither half is a schema dump. This machine has no pg_dump, no psql and no Supabase CLI, and
// PostgREST publishes relations and columns but not constraints, indexes, RLS policies, triggers or
// functions. What is committed is therefore an INVENTORY — accurate about what exists, silent about
// how it is shaped — and it must not be mistaken for something a fresh environment can be built from.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }

const MIG = new URL('../supabase/migrations/', import.meta.url)
/**
 * THE FOUNDING SCHEMA IS A DECLARING FILE TOO, and missing it is how nine tables were reported as
 * created by nothing. supabase/schema.sql is the hand-written original — "Run this in Supabase SQL
 * Editor" — and it is where tenants, contacts, conversations and six others actually come from. The
 * folder is not the whole of the declaration; this file is the rest of it.
 */
const SCHEMA_SQL = new URL('../supabase/schema.sql', import.meta.url)
const INVENTORY = new URL('../supabase/schema-inventory.json', import.meta.url)

/** Every relation PostgREST exposes on the public schema. Views included — it does not distinguish. */
async function liveRelations() {
  const r = await fetch(`${SB}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`PostgREST root returned ${r.status}`)
  return Object.keys((await r.json()).definitions ?? {}).sort()
}

/**
 * What the folder claims to create.
 *
 * Comments and quoted literals are stripped first, and both removals earn their place: the word
 * "would" following "create table" in a sentence was read as a table name, and the format string
 * 'CREATE TABLE IF NOT EXISTS referral_clicks_%s …' inside a DO block was read as another. Scanning
 * the prose for schema is how a drift report grows false positives, and a report nobody trusts is
 * one nobody runs.
 */
const strip = (sql) => sql
  .replace(/--[^\n]*/g, ' ')               // line comments FIRST: a `/*` inside prose would otherwise open one
  .replace(/\/\*[\s\S]*?\*\//g, ' ')     // block comments
  .replace(/'(?:[^']|'')*'/g, "''")        // string literals, including the dynamic SQL in DO blocks

function declared() {
  const tables = new Set(); const views = new Set()
  const sources = [...readdirSync(MIG).filter((n) => n.endsWith('.sql')).map((n) => new URL(n, MIG)), SCHEMA_SQL]
  for (const url of sources) {
    const sql = strip(readFileSync(url, 'utf8'))
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_0-9]+)/gi)) tables.add(m[1])
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+([a-z_0-9]+)/gi)) views.add(m[1])
  }
  return { tables: [...tables].sort(), views: [...views].sort() }
}

/**
 * Declared, and legitimately not published by PostgREST.
 *
 * A partition is a real table that PostgREST does not expose separately from its parent, so it can
 * never appear in the live list and must not be reported as missing forever.
 */
const NOT_PUBLISHED = new Set(['referral_clicks_default'])

const live = await liveRelations()
const { tables, views } = declared()
const declaredAll = new Set([...tables, ...views])
const liveSet = new Set(live)

const orphans = live.filter((t) => !declaredAll.has(t))          // exists, nothing creates it
const missing = [...declaredAll].filter((t) => !liveSet.has(t) && !NOT_PUBLISHED.has(t))

console.log(`live relations        ${live.length}`)
console.log(`declared by the repo   ${declaredAll.size}  (${tables.length} tables, ${views.length} views)`)
console.log(`\nIN THE DATABASE, DECLARED NOWHERE — ${orphans.length}`)
for (const t of orphans) console.log(`  ${t}`)
console.log(`\nDECLARED, NOT IN THE DATABASE — ${missing.length}`)
for (const t of missing) console.log(`  ${t}`)

if (process.argv.includes('--write')) {
  writeFileSync(INVENTORY, JSON.stringify({
    note: 'Generated by scripts/verify-schema-drift.mjs --write. An INVENTORY of what exists, not a schema dump: no constraints, indexes, RLS, triggers or functions. Do not build an environment from it.',
    takenAt: new Date().toISOString().slice(0, 10),
    liveRelations: live,
    declaredNowhere: orphans,
    declaredButAbsent: missing,
  }, null, 2) + '\n')
  console.log(`\nwrote supabase/schema-inventory.json`)
}

// A non-zero exit when the folder claims something that is not there. Orphans do NOT fail: there are
// 78 of them today and failing on a known number would only teach somebody to raise the number.
process.exit(missing.length ? 1 : 0)
