import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE PHONE NAVIGATES THROUGH ONE SURFACE, AND IT IS THE RAIL'S.
//
// v1 had a five-slot tab bar plus a "More" drawer — two surfaces, two languages, and the split at
// four decided by which modules a tenant had enabled, so no two businesses navigated the same way.
// It is replaced by /v2's swipe-up sheet. These tests exist so the bar cannot come back quietly and
// so the sheet cannot drift into being a second nav list beside the rail's.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const sidebar = read('components/dashboard/sidebar.tsx')
const sheet = read('components/dashboard/mobile-sheet.tsx')
const css = read('app/(v2)/v2/v2-tokens.css')
const bell = read('components/dashboard/notification-center.tsx')

describe('the tab bar is gone', () => {
  it('has no bottom-pinned nav and no More drawer left in the sidebar', () => {
    expect(sidebar).not.toMatch(/fixed bottom-0/)
    expect(sidebar).not.toMatch(/MoreHorizontal/)
    expect(sidebar).not.toMatch(/moreOpen|bottomPrimaryVisible|bottomMoreVisible/)
  })

  it('renders the sheet instead, and only on a phone', () => {
    expect(sidebar).toContain('<MobileSheet label="Menu">')
    expect(sheet).toMatch(/className="v2 v2-navhost md:hidden"/)
  })
})

describe('the sheet is the rail, not a second list', () => {
  it('builds its rows from the same visibleNav and the same SECTIONS', () => {
    // One source for both. A module disabled, or an operator in a client workspace, removes the row
    // from the rail and the sheet together because there is only one array.
    const body = sidebar.slice(sidebar.indexOf('<MobileSheet'))
    expect(body).toMatch(/SECTIONS\.map/)
    expect(body).toMatch(/visibleNav\.find\(\(i\) => i\.label === label\)/)
    expect(body).toMatch(/INERT\.has\(label\)/)
    // The rail resolves its rows the same way, so the two cannot diverge without this failing.
    const rail = sidebar.slice(sidebar.indexOf('<aside'), sidebar.indexOf('<MobileSheet'))
    expect(rail).toMatch(/visibleNav\.find\(\(i\) => i\.label === label\)/)
  })

  it('carries the trial row, the ON badge and sign out', () => {
    const body = sidebar.slice(sidebar.indexOf('<MobileSheet'))
    expect(body).toMatch(/planRow\.label/)
    expect(body).toMatch(/planRow\.badge/)
    expect(body).toMatch(/label === 'AI Employees' && aiOn/)
    expect(body).toMatch(/onClick=\{handleSignOut\}/)
  })

  it('closes itself on navigation and on escape, and holds the page still', () => {
    expect(sheet).toMatch(/useEffect\(\(\) => \{ setOpen\(false\) \}, \[pathname\]\)/)
    expect(sheet).toMatch(/e\.key === 'Escape'/)
    expect(sheet).toMatch(/b\.style\.overflow = 'hidden'/)
  })

  it('reuses /v2\'s sheet and its drag, rather than a second one', () => {
    expect(sheet).toContain("from '@/app/(v2)/v2/use-sheet-drag'")
    expect(sheet).toMatch(/className="v2-sheet"/)
    expect(sheet).toMatch(/className="v2-grab"/)
    // The host is what makes /v2's position:absolute sheet behave as fixed without a copy of it.
    expect(css).toMatch(/\.v2-navhost \{[\s\S]*?position: fixed[\s\S]*?\}/)
    // …and it must be transparent: `.v2` paints --v2-paper, which on a fixed inset-0 element is a
    // sheet of white over the whole app. That shipped as a blank screen once.
    expect(css).toMatch(/\.v2-navhost \{[\s\S]*?background: transparent[\s\S]*?\}/)
  })
})

describe('the three things at the bottom of a phone do not fight', () => {
  it('publishes the handle\'s height so a pinned control can clear it', () => {
    expect(css).toMatch(/--v2-grab-h: calc\(46px \+ env\(safe-area-inset-bottom\)\);/)
    // /inbox/[id]'s Take Over bar is the one that needs it — it is the last flex child of an
    // h-screen page, so it sits on the viewport's bottom edge. OUTSTANDING §23.
    expect(read('app/inbox/[id]/page.tsx')).toMatch(/paddingBottom: 'calc\(12px \+ var\(--v2-grab-h\)\)'/)
  })

  it('puts the bell above the handle rather than on it', () => {
    // The handle is a full-width strip inside a host at z-index 55; the bell is z-50. An overlap
    // would not be a near miss — the handle would simply take the tap.
    expect(bell).toMatch(/bottom-\[calc\(3\.5rem\+env\(safe-area-inset-bottom\)\)\]/)
    expect(css).toMatch(/\.v2-navhost \{[\s\S]*?z-index: 55[\s\S]*?\}/)
  })
})

describe('the dashboard has no fold', () => {
  const dash = read('app/dashboard/page.tsx')
  const hero = read('components/dashboard/hero/dashboard-hero.tsx')
  const column = read('components/dashboard/hero/home-column.tsx')
  const needs = read('components/dashboard/hero/needs-you.tsx')

  it('has no tab strip and nothing left to render under the hero', () => {
    // The markup, not the word — the file's own comment explains that ?tab=appointments is a dead
    // link now, and an assertion that cannot tell a comment from a link is not an assertion.
    expect(dash).not.toMatch(/href="\/dashboard\?tab=/)
    expect(dash).not.toMatch(/<(ImpactDashboard|AppointmentsTable)/)
    // Again the code, not the prose: the function must take no searchParams and derive no tab.
    expect(dash).toMatch(/export default async function DashboardPage\(\) \{/)
    expect(dash).not.toMatch(/const effectiveTab/)
    // The one remaining below-hero element is mobile-only and floats, so it costs the page no height.
    expect(hero).toMatch(/<section className="md:hidden fixed/)
  })

  it('moved Attention Needed into NEEDS YOU, with the anchor', () => {
    expect(column).toMatch(/<NeedsYou className="v2-blk" fallback=\{view\.needsYou\} anchor \/>/)
    expect(needs).toMatch(/id=\{anchor \? 'attention-needed' : undefined\}/)
    // The store is the live source — a dismiss anywhere updates it the same frame.
    expect(needs).toMatch(/useAttention\(\)/)
    expect(needs).toMatch(/attentionStore\.dismiss\(item\)/)
    // Empty only when BOTH the notification queue and the arrivals rows are empty. An empty state
    // shown over a non-empty queue is the bug this move exists to end.
    expect(needs).toMatch(/const total = attention\.length \+ fallback\.length/)
    expect(needs).toMatch(/total === 0/)
  })

  it('gave appointments a page rather than deleting the tab', () => {
    expect(existsSync(join(process.cwd(), 'app/appointments/page.tsx'))).toBe(true)
    expect(read('components/dashboard/sidebar.tsx')).toMatch(/href: '\/appointments'/)
    // …and took it off the inert list, which is what made the rail row honest.
    expect(read('components/dashboard/sidebar.tsx')).toMatch(/const INERT = new Map<string, typeof Calendar>\(\[\['Knowledge', BookLock\]\]\)/)
    expect(read('lib/modules.ts')).toMatch(/\{ prefix: '\/appointments', module: 'scheduling' \}/)
  })

  it('portals anything fixed that a transformed ancestor could capture', () => {
    // A transform on an ancestor becomes the containing block for position:fixed. The pill sits in
    // an sx-animate-in section, and the drawer measured [0,56,390,844] before this — 56px off the
    // bottom of the screen, with its last row under the swipe handle.
    expect(read('components/dashboard/attention.tsx')).toMatch(/createPortal\(/)
    expect(read('components/v2/modal.tsx')).toMatch(/createPortal\(/)
  })
})
