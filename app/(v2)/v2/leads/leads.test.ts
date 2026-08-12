import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { leadsLine } from './line'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('the opening line is true or it does not say it', () => {
  it('names the oldest lead still waiting', () => {
    const segs = leadsLine({ newCount: 3, openCount: 2, bookedCount: 1, oldestWaiting: { name: 'Marcus Webb', waited: '4 hr' } })
    expect(segs.map((s) => s.text).join('')).toBe('3 new and 2 open. Marcus Webb has been waiting 4 hr.')
    // The accent is the conclusion, and it is the only accented clause.
    expect(segs.filter((s) => s.accent)).toHaveLength(1)
    expect(segs.find((s) => s.accent)!.text).toContain('Marcus Webb')
  })

  it('says nobody is waiting rather than naming someone who is not', () => {
    const segs = leadsLine({ newCount: 0, openCount: 0, bookedCount: 4, oldestWaiting: null })
    expect(segs.map((s) => s.text).join('')).toBe('4 leads booked. Nobody is waiting on you.')
  })

  it('distinguishes "all settled" from "none at all"', () => {
    const none = leadsLine({ newCount: 0, openCount: 0, bookedCount: 0, oldestWaiting: null })
    expect(none.map((s) => s.text).join('')).toBe('No leads yet.')
  })

  it('omits a clause whose figure is zero rather than padding it', () => {
    const segs = leadsLine({ newCount: 1, openCount: 0, bookedCount: 0, oldestWaiting: { name: 'Elena', waited: '9 min' } })
    expect(segs.map((s) => s.text).join('')).toBe('1 new. Elena has been waiting 9 min.')
  })
})

describe('the list is shared, not a leads screen', () => {
  const list = code('app/(v2)/v2/list.tsx')

  it('knows nothing about leads', () => {
    // The moment this fails, the shape is wrong: the fix is a field on ListRow, not a branch in here.
    expect(list).not.toMatch(/lead|contacted|booked|dismissed/i)
  })

  it('filters by bucket, because a predicate cannot cross the server boundary', () => {
    expect(list).toMatch(/buckets: string\[\]/)
    expect(list).toMatch(/f\.buckets\.includes\(r\.bucket\)/)
  })

  it('derives every count from the rows it is showing', () => {
    // A count passed in can disagree with the list under it; one computed here cannot.
    expect(list).not.toMatch(/count\??: number/)
    expect(list).toMatch(/for \(const r of rows\) for \(const f of filters\)/)
  })
})

describe('leads reproduces what the current view does', () => {
  const page = code('app/(v2)/v2/leads/page.tsx')
  const table = code('components/dashboard/leads-table.tsx')

  it('All excludes dismissed, as the table hides it today', () => {
    expect(page).toMatch(/id: 'all', label: 'All', buckets: \['new', 'contacted', 'booked'\]/)
    // The behaviour it mirrors, still present in the table.
    expect(table).toMatch(/showDismissed \? rows : rows\.filter\(\(l\) => l\.status !== 'dismissed'\)/)
  })

  it('carries the same source labels and the same relative times', () => {
    for (const label of ['Missed Call', 'Voice Call', 'Web Form', 'Google LSA']) {
      expect(page).toContain(label)
      expect(table).toContain(label)
    }
    for (const unit of ['Just now', 'min ago', 'hr ago', 'd ago']) expect(page).toContain(unit)
  })

  it('adds no query — the dashboard loader already returned these rows', () => {
    expect(page).toMatch(/getDashboardData\(tenantId\)/)
    expect(page).not.toMatch(/\.from\('leads'\)/)
  })

  it('is read-only: every action is disabled and says why', () => {
    expect(page).toMatch(/const PREVIEW = 'v2 preview'/)
    // Every action literal carries the reason. None may be actionable.
    const actions = page.match(/\{ label: '[^']+'[^}]*\}/g) ?? []
    expect(actions.length).toBeGreaterThan(3)
    for (const a of actions) expect(a).toContain('disabledReason: PREVIEW')
    expect(code('app/(v2)/v2/list.tsx')).toMatch(/disabled=\{!!a\.disabledReason\}/)
  })

  it('is gated on pipeline, exactly as the dashboard tab is', () => {
    expect(page).toMatch(/modules\.includes\('pipeline'\)/)
    expect(code('app/dashboard/page.tsx')).toMatch(/modules\.includes\('pipeline'\)/)
    // The rail's gate now lives in nav.ts and is applied to the sheet from the same call, so this
    // asserts the single source rather than a copy inside the shell.
    expect(code('app/(v2)/v2/nav.ts')).toMatch(/module: 'pipeline'/)
    expect(code('app/(v2)/v2/home-client.tsx')).toMatch(/allowed\(PRIMARY, modules\)/)
    expect(code('app/(v2)/v2/data.ts')).toMatch(/allowed\(PRIMARY, modules\)/)
  })
})

describe('the shared list survived four more screens', () => {
  const list = code('app/(v2)/v2/list.tsx')

  it('still knows nothing about any one screen', () => {
    // The test that matters. Leads, Inbox, Appointments and Orders all render through this component;
    // if any of them had needed a branch, this fails and the answer is a new ListRow field.
    expect(list).not.toMatch(/lead|inbox|conversation|appointment|order|contact/i)
  })

  it.each([
    ['app/(v2)/v2/inbox/page.tsx', 'getDashboardData'],
    ['app/(v2)/v2/appointments/page.tsx', 'getDashboardData'],
    ['app/(v2)/v2/orders/page.tsx', 'listOrders'],
    ['app/(v2)/v2/contacts/page.tsx', 'listContactsPage'],
  ])('%s adds no query — it reuses %s', (file, loader) => {
    const src = code(file)
    expect(src).toContain(loader)
    expect(src).not.toMatch(/\.from\('/)
  })

  it.each([
    ['app/(v2)/v2/inbox/page.tsx', 'inbox'],
    ['app/(v2)/v2/appointments/page.tsx', 'scheduling'],
    ['app/(v2)/v2/orders/page.tsx', 'orders'],
    ['app/(v2)/v2/leads/page.tsx', 'pipeline'],
    ['app/(v2)/v2/contacts/page.tsx', 'contacts'],
  ])('%s is gated on %s', (file, mod) => {
    expect(code(file)).toContain(`'${mod}'`)
  })

  it.each([
    'app/(v2)/v2/inbox/page.tsx',
    'app/(v2)/v2/appointments/page.tsx',
    'app/(v2)/v2/orders/page.tsx',
    'app/(v2)/v2/contacts/page.tsx',
  ])('%s is read-only', (file) => {
    const actions = code(file).match(/\{ label: '[^']+'[^}]*\}/g) ?? []
    expect(actions.length).toBeGreaterThan(0)
    for (const a of actions) expect(a).toContain('disabledReason: PREVIEW')
  })
})

describe('the contacts read is the page\'s own, extracted not rewritten', () => {
  it('the page delegates to it rather than keeping its query', () => {
    const page = code('app/contacts/page.tsx')
    expect(page).toMatch(/listContactsPage\(tenantId/)
    expect(page).not.toMatch(/\.from\('contacts'\)/)
  })

  it('the extraction kept every filter and both orderings', () => {
    const lib = code('lib/contacts/page-read.ts')
    for (const part of ["is('merged_into_id', null)", "order('last_interaction'", "order('name'", 'escapeSearchTerm(q)']) {
      expect(lib).toContain(part)
    }
  })
})

describe('the detail screens read what the real pages read', () => {
  it('the contact profile query moved to lib and the page delegates', () => {
    const page = code('app/contacts/[id]/page.tsx')
    expect(page).toMatch(/readContactProfile\(tenantId, id\)/)
    expect(page).not.toMatch(/\.from\('contacts'\)/)
    expect(page).not.toMatch(/\.from\('conversations'\)/)
  })

  it('notFound stayed in the page — it is a routing decision, not a read', () => {
    expect(code('lib/contacts/profile-read.ts')).not.toMatch(/notFound/)
    expect(code('app/contacts/[id]/page.tsx')).toMatch(/if \(!profile\) notFound\(\)/)
  })

  it.each([
    ['app/(v2)/v2/orders/[id]/page.tsx', 'getOrder'],
    ['app/(v2)/v2/contacts/[id]/page.tsx', 'readContactProfile'],
  ])('%s adds no query — it reuses %s', (file, loader) => {
    const src = code(file)
    expect(src).toContain(loader)
    expect(src).not.toMatch(/\.from\('/)
  })

  it('v2 list rows stay inside v2', () => {
    // A row that left for the old app made the preview a dead end in one tap.
    expect(code('app/(v2)/v2/contacts/page.tsx')).toMatch(/\/v2\/contacts\/\$\{c\.id\}/)
    expect(code('app/(v2)/v2/orders/page.tsx')).toMatch(/\/v2\/orders\/\$\{o\.id\}/)
  })
})
