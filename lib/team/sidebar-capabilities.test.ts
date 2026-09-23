import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ── THE RAIL MUST BE RIGHT ON THE FIRST PAINT ───────────────────────────────────────────────────────
//
// The sidebar used to start from the owner's capability set and narrow itself once /api/me/context
// came back, so a staff member's first frame contained "Settings" and "Billing & Subscription" —
// rows the routes then refuse her. Nothing was insecure about it: the routes 307'd her to /dashboard
// either way. It was a lie on screen for one frame, and the kind that erodes trust in everything
// beside it.
//
// The fix is that the SERVER decides. These assertions are about where the decision is made, because
// that is the thing that would quietly regress — somebody removes the prop, the client fetch still
// "works", and the flash is back with every test passing.

const shell = readFileSync(new URL('../../components/app/app-shell.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../../components/dashboard/sidebar.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../workspace.ts', import.meta.url), 'utf8')

describe('AppShell resolves capabilities on the server', () => {
  it('calls the one context function, not a second copy of the rules', () => {
    // Reusing requireActiveBusinessContext is what keeps the rail and the routes from disagreeing.
    // A hand-rolled `role === 'staff'` check here would be a second authorization system.
    expect(shell).toContain('requireActiveBusinessContext')
    expect(shell).toContain('const ctx = await requireActiveBusinessContext()')
    expect(shell).not.toMatch(/capabilitiesFor\(|role === ['"]staff['"]|role === ['"]owner['"]/)
  })

  it('hands them to the sidebar', () => {
    expect(shell).toMatch(/<Sidebar[^>]*capabilities=\{ctx\?\.capabilities \?\? null\}/)
  })
})

describe('the sidebar renders them, rather than discovering them', () => {
  it('seeds its state from the prop', () => {
    expect(sidebar).toContain('useState(capabilities ?? {')
  })

  it('does not re-fetch over a server answer', () => {
    // The client fetch stays for businessName / modules / plan, but must not write capabilities when
    // the server already supplied them — that write is what produced the visible change.
    expect(sidebar).toContain('if (!capabilities && ctx.capabilities)')
  })

  it('gates the three owner-only rows on capabilities', () => {
    expect(sidebar).toContain("if (i.label === 'Billing & Subscription' && !caps.canEditBilling) return false")
    expect(sidebar).toContain("if (i.label === 'Settings' && !caps.canEditSettings) return false")
    expect(sidebar).toContain("if (i.label === 'Team' && !caps.canManageTeam) return false")
  })

  it('keeps an all-true fallback ONLY for the shell-less render probe', () => {
    // The probe mounts the rail with no AppShell around it. Defaulting to the owner's set there keeps
    // its geometry honest; every real page passes the prop, so the fallback is unreachable in the app.
    expect(sidebar).toMatch(/useState\(capabilities \?\? \{ canEditBilling: true, canEditSettings: true, canManageTeam: true \}\)/)
  })
})

describe('resolving it twice in one render is free', () => {
  it('requireActiveBusinessContext is React-cached', () => {
    // The shell resolves it and so does the page inside the shell. Without cache() that is two
    // auth.getUser() round-trips on every authenticated page load.
    expect(workspace).toContain('export const requireActiveBusinessContext = cache(')
  })
})
