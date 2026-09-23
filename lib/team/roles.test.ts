import { describe, it, expect } from 'vitest'
import {
  capabilitiesFor,
  canManageMember,
  intersect,
  ASSIGNABLE_ROLES,
  TEAM_ROLES,
  NO_CAPABILITIES,
  isTeamRole,
  type TeamRole,
} from './roles'

// The capability matrix, tested directly, because it is the whole answer to "may she?" and every
// route that asks reads it from here. A change to the matrix that nobody intended should fail a test
// rather than reach a customer's account.

describe('what each role may do', () => {
  it('gives the owner everything', () => {
    expect(capabilitiesFor('owner')).toEqual({
      canOperate: true, canEditBilling: true, canEditSettings: true, canViewCosts: true, canManageTeam: true,
    })
  })

  it('lets staff work, and nothing else', () => {
    // CASE 4 + 5 of the regression set, in one assertion: she can operate — contacts, orders,
    // proposals, studio, documents, inbox, calendar all gate on canOperate plus the tenant's modules —
    // and every owner-level action is false.
    expect(capabilitiesFor('staff')).toEqual({
      canOperate: true, canEditBilling: false, canEditSettings: false, canViewCosts: false, canManageTeam: false,
    })
  })

  it('lets a manager see costs but never touch billing or the team', () => {
    const m = capabilitiesFor('manager')
    expect(m.canOperate).toBe(true)
    expect(m.canViewCosts).toBe(true)
    expect(m.canEditSettings).toBe(true)
    expect(m.canEditBilling).toBe(false)
    expect(m.canManageTeam).toBe(false)
  })

  it('never hands out ownership through the invite UI', () => {
    // An owner may create staff and managers. Ownership moves by a deliberate transfer, not by
    // picking it from a dropdown, so it must not appear in the assignable list.
    expect(ASSIGNABLE_ROLES).toEqual(['manager', 'staff'])
    expect(ASSIGNABLE_ROLES).not.toContain('owner')
  })

  it('returns a copy, so a caller narrowing capabilities cannot poison the matrix', () => {
    const a = capabilitiesFor('staff')
    a.canEditBilling = true
    expect(capabilitiesFor('staff').canEditBilling).toBe(false)
  })

  it('describes every role it declares', () => {
    const described = new Set(TEAM_ROLES.map((r) => r.key))
    for (const r of ['owner', 'manager', 'staff'] as TeamRole[]) expect(described.has(r)).toBe(true)
  })

  it('grants nothing at all when there is no live membership', () => {
    expect(Object.values(NO_CAPABILITIES).every((v) => v === false)).toBe(true)
  })

  it('rejects anything that is not a role', () => {
    expect(isTeamRole('admin')).toBe(false)
    expect(isTeamRole('super_admin')).toBe(false)
    expect(isTeamRole(undefined)).toBe(false)
  })
})

describe('two kinds of restricted compose', () => {
  it('takes the intersection, in either order', () => {
    // A White Label operator working inside a client business is narrowed by their partner role. If
    // that business ALSO gives them a team role, the answer must be what both allow — and must not
    // depend on which narrowing was applied last.
    const staff = capabilitiesFor('staff')
    const operator = { canOperate: true, canEditBilling: true, canEditSettings: true, canViewCosts: false, canManageTeam: false }
    expect(intersect(staff, operator)).toEqual(intersect(operator, staff))
    expect(intersect(staff, operator).canEditBilling).toBe(false)
  })

  it('cannot widen anything', () => {
    const owner = capabilitiesFor('owner')
    const narrow = capabilitiesFor('staff')
    expect(intersect(owner, narrow)).toEqual(narrow)
  })
})

describe('who may edit whom', () => {
  const OWNER = { role: 'owner' as TeamRole, userId: 'u-owner' }
  const STAFF = { role: 'staff' as TeamRole, userId: 'u-staff' }

  it('lets the owner manage staff', () => {
    expect(canManageMember(OWNER, STAFF)).toBe(true)
  })

  it('refuses a staff member managing anybody', () => {
    // She cannot change another user's permissions — including her own.
    expect(canManageMember(STAFF, { role: 'staff', userId: 'u-other' })).toBe(false)
    expect(canManageMember(STAFF, STAFF)).toBe(false)
  })

  it('refuses a manager managing anybody', () => {
    expect(canManageMember({ role: 'manager', userId: 'u-m' }, STAFF)).toBe(false)
  })

  it('never lets anyone act on an owner', () => {
    // No demotion, no deactivation, no accidental "the business now has no owner".
    expect(canManageMember(OWNER, { role: 'owner', userId: 'u-other-owner' })).toBe(false)
  })

  it('never lets anyone act on themselves', () => {
    // An owner removing their own access locks the business out of its own account.
    expect(canManageMember(OWNER, { role: 'owner', userId: 'u-owner' })).toBe(false)
    expect(canManageMember({ role: 'owner', userId: 'u-x' }, { role: 'staff', userId: 'u-x' })).toBe(false)
  })

  it('still allows acting on a row that has no auth user yet', () => {
    // A seat reserved before the person ever signed in has user_id NULL; the self-check must not
    // silently match on null === null and make the row uneditable.
    expect(canManageMember(OWNER, { role: 'staff', userId: null })).toBe(true)
  })
})
