import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { agendaLine } from './line'

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const view = read('./agenda.tsx')
const page = strip(read('./page.tsx'))
const lib = read('../../../../lib/appointments/agenda.ts')
const css = read('../v2-tokens.css')
const ref = read('../../../../docs/miles/appointments-agenda-v2.html')

/** The agenda's own block, bounded at the next foreign banner — same rule as conversation.test.ts. */
const block = (() => {
  const marker = css.indexOf('THE AGENDA — docs/miles/appointments-agenda-v2.html')
  const start = css.lastIndexOf('/*', marker)
  let at = marker
  for (;;) {
    at = css.indexOf('\n/* ═', at + 1)
    if (at < 0) return css.slice(start)
    const title = css.slice(at, at + 400).split('\n')[2] ?? ''
    if (!title.trim().startsWith('THE AGENDA')) return css.slice(start, at)
  }
})()

describe('the values come from the reference, not from nearby', () => {
  it('the four kind colours are the file’s own', () => {
    for (const [name, hex] of [['onsite', '#8B5CF6'], ['zoom', '#2D8CFF'], ['meet', '#00A67E'], ['phone', '#22D3EE']] as const) {
      expect(ref, name).toContain(`--${name}:${hex}`)
    }
    expect(css).toContain('--ag-onsite: #8B5CF6;')
    expect(css).toContain('--ag-zoom: #2D8CFF;')
    expect(css).toContain('--ag-meet: #00A67E;')
    expect(css).toContain('--ag-phone: #22D3EE;')
    expect(css).toContain('--ag-phone-ink: #0E9BB5;')
  })

  it('the time rail is 64 on a phone and 86 wide', () => {
    expect(block).toContain('.v2 .v2-ag-time { width: 64px; flex: none; text-align: right; padding-top: 2px; }')
    expect(block).toContain('.v2 .v2-ag-time { width: 86px; }')
  })

  it('the spine is 3px', () => {
    expect(block).toMatch(/\.v2-ag-bar \{ width: 3px; border-radius: 3px/)
  })

  it('the actions are three equal columns, 38px, 7px gap — 104px fixed when wide', () => {
    expect(block).toContain('grid-template-columns: repeat(3, 1fr); gap: 7px;')
    expect(block).toContain('height: 38px;')
    expect(block).toContain('grid-template-columns: repeat(3, 104px);')
    // Never wrap, never hug content — that is what made the first version ragged.
    expect(block).toContain('.v2 .v2-ag-row { flex-wrap: nowrap; }')
  })

  it('every wide row is 96px whether or not it has a note', () => {
    expect(block).toContain('.v2 .v2-ag-row { align-items: center; min-height: 96px; }')
    expect(block).toContain('.v2 .v2-ag-svc { min-height: 19px; }')
    // The place line holds its height too, which is why it renders empty rather than not at all.
    expect(block).toMatch(/\.v2-ag-where \{[^}]*min-height: 17px/)
    expect(view).toContain('<p className="v2-ag-where" />')
  })

  it('the move options are 64px each', () => {
    expect(block).toMatch(/\.v2-ag-opt \{[^}]*min-height: 64px/)
  })
})

describe('the kind drives the primary action, not just the colour', () => {
  it('a video appointment gets a filled Join in the provider’s colour, and Text LINK second', () => {
    expect(view).toContain('data-join data-k={row.kind} href={row.joinUrl}')
    expect(block).toContain('.v2 .v2-ag-act[data-join][data-k="zoom"] { background: var(--ag-zoom); }')
    expect(block).toContain('.v2 .v2-ag-act[data-join][data-k="google_meet"] { background: var(--ag-meet); }')
    expect(view).toContain("{video ? 'Text link' : 'Text'}")
  })

  it('a phone callback’s primary IS the call', () => {
    expect(view).toContain("row.kind === 'phone' && tel ? (")
    expect(view).toContain('<Phone />Call now')
  })

  it('a missing thing promotes the fix to first position, in amber', () => {
    expect(view).toContain('data-fix')
    expect(view).toContain("{row.missing === 'address' ? 'Add address' : 'Add link'}")
    expect(block).toContain('.v2 .v2-ag-act[data-fix] {')
    expect(block).toMatch(/\.v2-ag-act\[data-fix\] \{[^}]*var\(--v2-hold-wash\)/)
  })

  it('and the amber spine outranks the kind’s colour', () => {
    // What is MISSING is more urgent than where it happens, so the rule comes last.
    expect(block.indexOf('.v2 .v2-ag-bar[data-pend]')).toBeGreaterThan(block.indexOf('[data-k="phone"] .v2-ag-bar'))
  })

  it('there are always exactly three actions', () => {
    const acts = view.slice(view.indexOf('<div className="v2-ag-acts">'), view.indexOf('// ── THE MOVE SHEET'))
    // Three slots: the kind's primary, the second, and Move — every branch fills its slot.
    expect(acts).toContain('onClick={onMove}')
    expect((acts.match(/className="v2-ag-act"/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })
})

describe('the kind is read, never inferred', () => {
  it('nothing looks at service_type', () => {
    // One live row is a completed on-site job called "Google Meet". Matching free text is how that
    // gets a violet spine and a Join button that goes nowhere.
    expect(lib).not.toMatch(/service_type[^,)\n]*(includes|match|test|toLowerCase)/)
    expect(view).not.toContain('service_type')
  })

  it('an unknown kind falls back to on_site rather than to a guess', () => {
    expect(lib).toContain("KINDS.includes(v as MeetingKind) ? (v as MeetingKind) : 'on_site'")
  })

  it('duration falls back to the tenant default, not to a number in the code', () => {
    expect(lib).toContain('default_appointment_minutes')
    expect(lib).toContain('r.duration_minutes && r.duration_minutes > 0 ? r.duration_minutes : fallback')
  })
})

describe('move ships partial and honest', () => {
  it('Cancel is wired to the one write the route accepts', () => {
    expect(view).toContain("body: JSON.stringify({ status: 'cancelled' })")
    expect(read('../../../api/appointments/[id]/route.ts')).toContain("['completed', 'cancelled', 'confirmed', 'scheduled'].includes(body.status)")
  })

  it('the other three render DISABLED with a reason rather than being hidden', () => {
    const sheet = view.slice(view.indexOf('function MoveSheet'))
    expect((sheet.match(/disabled title=\{PREVIEW\}/g) ?? []).length).toBe(3)
    expect(sheet).toContain('Later today')
    expect(sheet).toContain('Pick another day')
    expect(sheet).toContain('to reschedule')
  })

  it('"they\'ll be told" is NOT on Cancel — nothing notifies them yet', () => {
    const sheet = view.slice(view.indexOf('function MoveSheet'))
    expect(sheet).not.toMatch(/They'?(ll|’ll) be told/)
    expect(sheet).toContain('The slot frees up')
    // The reference says it; we do not, until something does.
    expect(ref).toContain("They'll be told")
  })

  it('New is LIVE — a disabled create on an empty screen can never fill it', () => {
    // It shipped disabled with a reason, which was right while there was no owner-side route. There
    // is one now (/api/appointments), so the reason is gone and so is the disabled state.
    expect(page).toContain('<NewAppointment grid={grid} defaultMinutes=')
    expect(page).not.toContain('PREVIEW')
  })
})

describe('the opening line', () => {
  const say = (i: Parameters<typeof agendaLine>[0]) => agendaLine(i).map((s) => s.text).join('')

  it('reads like the reference when something is missing', () => {
    expect(say({ todayCount: 4, laterCount: 1, missingCount: 1 })).toBe('4 booked today. One is missing something.')
  })

  it('accents the conclusion and only the conclusion', () => {
    const segs = agendaLine({ todayCount: 4, laterCount: 0, missingCount: 2 })
    expect(segs.filter((s) => s.accent)).toHaveLength(1)
    expect(segs.at(-1)!.text).toContain('2 are missing')
  })

  it('says nothing rather than padding a zero', () => {
    expect(say({ todayCount: 0, laterCount: 3, missingCount: 0 })).toBe('Nothing today. 3 coming up. They are all set.')
    expect(say({ todayCount: 0, laterCount: 0, missingCount: 0 })).toBe('Nothing booked yet.')
  })
})

describe('the client boundary', () => {
  it('the row actions do not import a server module', () => {
    // list-page.ts reaches next/headers through lib/workspace; importing PREVIEW from there dragged
    // cookies() into the browser bundle and failed the build. The mirror of the channels.ts note.
    expect(view).toContain("import { PREVIEW } from '../preview'")
    // Comments stripped: the note in that file NAMES the imports it must not have, and should.
    expect(strip(read('../preview.ts'))).not.toMatch(/import/)
  })
})

describe('the past has somewhere to live', () => {
  it('runs below the agenda under its own day groups, not behind a filter', () => {
    // A chip that replaces the screen hides today to show last week, and an agenda you can point
    // backwards stops being an agenda. Days continue downward in the direction time does.
    expect(view).toContain('agenda.earlier.length > 0 && (')
    expect(view).toContain('{agenda.earlier.map(day)}')
    expect(view).toContain('<span className="v2-ag-gt">EARLIER</span>')
    expect(page).not.toMatch(/filters=|ListFilter/)
  })

  it('one renderer for both directions, so they cannot drift', () => {
    expect(view).toContain('const day = (d: (typeof agenda.days)[number]) => (')
    expect(view).toContain('{agenda.days.map(day)}')
  })

  it('newest first going back, and yesterday gets a word', () => {
    expect(lib).toContain('.sort((a, b) => (a.key < b.key ? 1 : -1))')
    expect(lib).toContain('`YESTERDAY · ${dayStamp(d.key)}`')
  })

  it('cancelled rows appear ONLY there', () => {
    // A cancelled slot is not on your agenda; "did I cancel that?" is still a real question.
    expect(lib).toContain("const rows = all.filter((r) => r.slot_date >= now.dateIso ? r.status !== 'cancelled' : true)")
  })

  it('and are struck through, which nobody has to be taught', () => {
    expect(block).toContain('.v2 .v2-ag-row[data-cancelled] .v2-ag-name { text-decoration: line-through;')
  })

  it('a past row keeps its shape and loses its actions', () => {
    // Nothing to move, and calling about a job you finished last week is a different intention that
    // belongs on the contact.
    expect(view).toContain('{!r.past && <Actions row={r}')
    expect(block).toContain('.v2 .v2-ag-row[data-past] .v2-ag-name { color: var(--v2-ink-70); }')
  })

  it('a gap on something that already happened is not counted as needing you', () => {
    expect(lib).toContain('if (missing && !isPast) missingCount++')
  })

  it('is bounded, and loaded by the same read', () => {
    expect(lib).toContain('export const EARLIER_DAYS = 30')
    expect(lib).toContain(".gte('slot_date', fromIso)")
    // ONE query for the agenda — earlier and upcoming come from the same read, not two.
    const readFn = lib.slice(lib.indexOf('export async function readAgenda'), lib.indexOf('export async function readSlotGrid'))
    expect((readFn.match(/from\('appointments'\)/g) ?? []).length).toBe(1)
  })

  it('the empty state only shows when there is nothing in EITHER direction', () => {
    expect(page).toContain('agenda.days.length === 0 && agenda.earlier.length === 0 ?')
  })
})
