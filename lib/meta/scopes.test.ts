import { describe, expect, it } from 'vitest'
import { META_SCOPES } from './scopes'

// These assertions exist because the drift they guard against was invisible: two hardcoded lists asked
// for two permissions that were never submitted to Meta, nothing failed at build or test time, and a
// tenant found it. On a Live app an unapproved permission is still grantable to someone holding a role
// on the app — so it worked for the developer and blocked the business owner.

/** Approved in Meta → App Review → Permissions and Features. Update ONLY after an approval. */
const APPROVED = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_messages',
]

describe('META_SCOPES', () => {
  it('never asks for anything that has not been approved', () => {
    // The failure mode is not degraded — an unapproved scope blocks the whole dialog for ordinary
    // users. Asking for more than was granted is the bug, not the safety margin.
    const extra = META_SCOPES.filter((s) => !APPROVED.includes(s))
    expect(extra).toEqual([])
  })

  it('does not request the two that caused this', () => {
    expect(META_SCOPES).not.toContain('pages_read_engagement')
    expect(META_SCOPES).not.toContain('business_management')
  })

  it('still covers every call the flow makes', () => {
    // /me/accounts, the instagram_business_account field, subscribed_apps, and messaging both ways.
    for (const needed of APPROVED) expect(META_SCOPES).toContain(needed)
  })

  it('has no duplicates', () => {
    expect(new Set(META_SCOPES).size).toBe(META_SCOPES.length)
  })
})

describe('nothing sends this list any more', () => {
  it('is not referenced by either connect route', async () => {
    // Under Facebook Login for Business the dialog is driven by config_id and Meta's dashboard holds
    // the permissions. A route that still sent `scope` would be the old, broken shape — the one that
    // produced "Feature Unavailable" and blocked every tenant. This asserts the shape, not the list.
    const { readFileSync } = await import('fs')
    for (const f of [
      'app/api/auth/meta/connect/route.ts',
      'app/api/admin/meta-review-demo/connect/route.ts',
    ]) {
      const src = readFileSync(f, 'utf8')
      expect(src).toContain("searchParams.set('config_id'")
      expect(src).toContain("searchParams.set('override_default_response_type', 'true')")
      expect(src).not.toMatch(/searchParams\.set\('scope'/)
    }
  })
})
