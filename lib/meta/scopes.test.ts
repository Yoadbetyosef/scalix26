import { describe, expect, it } from 'vitest'
import { META_SCOPES, metaScopeParam } from './scopes'

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

  it('formats as the OAuth dialog expects — comma separated, no spaces', () => {
    expect(metaScopeParam()).toBe(APPROVED.join(','))
    expect(metaScopeParam()).not.toMatch(/\s/)
  })

  it('has no duplicates', () => {
    expect(new Set(META_SCOPES).size).toBe(META_SCOPES.length)
  })
})

describe('there is only one list', () => {
  it('is a rule enforced by imports, not by a comment', () => {
    // Both connect routes import metaScopeParam(). If a third copy appears, this test cannot catch it
    // — but the file it would have to duplicate says why not to, and this suite is what a reviewer is
    // pointed at. The mechanism is the shared module; this documents the intent beside it.
    expect(typeof metaScopeParam()).toBe('string')
  })
})
