// ── WHO, INSIDE ONE BUSINESS, MAY DO WHAT ───────────────────────────────────────────────────────────
//
// A business used to be one person, so there was nothing to decide. Now a business can have a team,
// and this file is the ONE place that says what each of them may do. It is pure — no database, no
// session, no imports from the app — so the whole matrix is unit-testable and so that nobody is ever
// tempted to answer "may she?" anywhere else.
//
// IT DELIBERATELY EXTENDS THE EXISTING CAPABILITY OBJECT RATHER THAN INTRODUCING A SECOND SYSTEM.
// `ActiveBusinessContext.capabilities` already exists, is already the thing White Label operator mode
// narrows, and is already read at eight call sites (costs, expenses, supplier invoices, settings,
// money-out). Adding a parallel permission vocabulary beside it would mean two answers to one
// question, and the two would drift — which is the failure this codebase keeps finding.
//
// So: one new capability (canManageTeam), one new input (the member's role), same object out.

/**
 * The three roles a business team has. Small on purpose.
 *
 *   owner   — the person the business belongs to. Billing, ownership, team, everything.
 *   manager — runs the business day to day and sees what things cost. No billing, no team.
 *   staff   — does the operational work: customers, orders, documents, inbox, calendar.
 *
 * There is no 'admin' here and there should not be. Scalix's own admin plane is a different plane
 * (lib/admin/emails.ts, allow-listed by email) and no business role may ever reach it.
 */
export type TeamRole = 'owner' | 'manager' | 'staff'

export const TEAM_ROLES: { key: TeamRole; label: string; blurb: string }[] = [
  { key: 'owner',   label: 'Owner',   blurb: 'Full access, including billing and the team.' },
  { key: 'manager', label: 'Manager', blurb: 'Runs the business day to day and can see costs. No billing.' },
  { key: 'staff',   label: 'Staff',   blurb: 'Customers, orders, documents and the inbox. No costs or billing.' },
]

/** Roles an owner may hand out. Ownership is not one of them — see transferring, below. */
export const ASSIGNABLE_ROLES: TeamRole[] = ['manager', 'staff']

export function isTeamRole(v: unknown): v is TeamRole {
  return v === 'owner' || v === 'manager' || v === 'staff'
}

export type MemberStatus = 'active' | 'invited' | 'disabled'

export function isMemberStatus(v: unknown): v is MemberStatus {
  return v === 'active' || v === 'invited' || v === 'disabled'
}

/**
 * The capability object the rest of the app already reads.
 *
 * canManageTeam is the only new member. Everything else keeps the meaning it already had, so the
 * eight existing call sites are untouched by this change.
 */
export interface BusinessCapabilities {
  /** May act in the business at all: create and edit operational records. */
  canOperate: boolean
  /** May change the subscription, payment method, or plan. */
  canEditBilling: boolean
  /** May change business settings — hours, channels, the AI employee's configuration. */
  canEditSettings: boolean
  /**
   * May see what the business PAYS — product cost, supplier invoices, expenses, margin.
   * A business's margin structure is not operational data; it is the thing the business is.
   */
  canViewCosts: boolean
  /** May invite, re-invite, change the role of, or deactivate another member. */
  canManageTeam: boolean
}

/**
 * THE MATRIX. Everything else in this file is a lookup into it.
 *
 * Note what staff does NOT get, and that none of it is a special case for any one customer:
 * no billing, no settings, no costs, no team. Those are the owner-level actions; the operational
 * surface — contacts, orders, proposals, studio, documents, inbox, calendar — is gated by
 * canOperate and by the tenant's enabled modules, both of which staff passes.
 */
const MATRIX: Record<TeamRole, BusinessCapabilities> = {
  owner: {
    canOperate: true,
    canEditBilling: true,
    canEditSettings: true,
    canViewCosts: true,
    canManageTeam: true,
  },
  manager: {
    canOperate: true,
    canEditBilling: false,
    canEditSettings: true,
    canViewCosts: true,
    canManageTeam: false,
  },
  staff: {
    canOperate: true,
    canEditBilling: false,
    canEditSettings: false,
    canViewCosts: false,
    canManageTeam: false,
  },
}

/** What this role may do. Returns a fresh object so a caller narrowing it cannot mutate the matrix. */
export function capabilitiesFor(role: TeamRole): BusinessCapabilities {
  return { ...MATRIX[role] }
}

/**
 * A disabled or still-invited member can do NOTHING. Used by the resolver so a deactivated person
 * loses access on their next request rather than at their next login — see lib/team/members.ts.
 */
export const NO_CAPABILITIES: BusinessCapabilities = {
  canOperate: false,
  canEditBilling: false,
  canEditSettings: false,
  canViewCosts: false,
  canManageTeam: false,
}

/**
 * Narrow a capability set by another one — every capability must be granted by BOTH.
 *
 * This is how the two ideas of "restricted" compose instead of fighting. A White Label operator
 * working inside a client business is already narrowed by their partner role; if that business also
 * gives them a team role, the answer is the intersection, and the order the two are applied in cannot
 * change the result. Without this, whichever one was applied last would silently win.
 */
export function intersect(a: BusinessCapabilities, b: BusinessCapabilities): BusinessCapabilities {
  return {
    canOperate: a.canOperate && b.canOperate,
    canEditBilling: a.canEditBilling && b.canEditBilling,
    canEditSettings: a.canEditSettings && b.canEditSettings,
    canViewCosts: a.canViewCosts && b.canViewCosts,
    canManageTeam: a.canManageTeam && b.canManageTeam,
  }
}

/**
 * May `actor` change `target`'s membership (role change, deactivation, re-invite)?
 *
 * Three rules, and the second and third are the ones that matter:
 *   1. You must be able to manage the team at all.
 *   2. NOBODY may act on an owner. Ownership is transferred deliberately, by a different action, not
 *      by editing a row on the team screen — so an owner cannot be demoted or deactivated here, and
 *      a business can never end up with no owner because somebody tidied the list.
 *   3. You may not act on yourself. An owner removing their own access locks the business out; a
 *      manager promoting themselves is the escalation this whole file exists to prevent.
 */
export function canManageMember(
  actor: { role: TeamRole; userId: string },
  target: { role: TeamRole; userId: string | null },
): boolean {
  if (!capabilitiesFor(actor.role).canManageTeam) return false
  if (target.role === 'owner') return false
  if (target.userId && target.userId === actor.userId) return false
  return true
}
