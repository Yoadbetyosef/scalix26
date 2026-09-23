import { createAdminClient } from '@/lib/supabase/server'
import { type TeamRole, type MemberStatus, isTeamRole } from './roles'

// The mailer is imported lazily, inside inviteMember, rather than at the top of this file.
// lib/email/send.ts constructs its Resend client at module load and throws without an API key — and
// this module sits on the hot path of EVERY authenticated request, because lib/workspace.ts imports
// resolveMembership. Dragging the mailer (and a required secret) into that path to send an email a
// few times a year is the wrong trade. Same reason lib/billing/gate.ts lazy-imports its deps.

// ── THE TEAM OF ONE BUSINESS ────────────────────────────────────────────────────────────────────────
//
// Everything that reads or writes tenant_members goes through here. The table is RLS-locked with no
// policies (see the migration), so this module uses the admin client and is responsible for the tenant
// scoping itself — every query below is keyed on a tenantId the CALLER resolved server-side, never on
// anything a browser supplied.
//
// ── ACTIVE vs INVITED, AND WHY THEY ARE NOT THE SAME COLUMN ────────────────────────────────────────
//
// `status` is the ACCESS state and has exactly one value that grants anything: 'active'. 'disabled' is
// the revoked state. Both get_tenant_id() and the workspace resolver read that one word, so there is a
// single rule and no second place for it to disagree.
//
// `accepted_at` is the LIFECYCLE, and it is what the Team screen renders as "Invited" vs "Active". A
// row is written 'active' at invite time, before the person has ever signed in, and that is safe
// because the row grants nothing on its own: the auth user created alongside it has NO PASSWORD, and
// the only way to get one is the emailed link. Access is gated by authentication, which this table
// does not perform.
//
// The alternative — status='invited' until first login — needs the resolver to accept two states and
// promote one to the other, which means RLS must accept both too, which means the revoke check is
// suddenly 'not in this set' instead of 'equals this word'. That is a worse thing to be right about.
// ('invited' remains a legal CHECK value, reserved for a future flow where an owner reserves a seat
// without sending mail. Nothing writes it today.)

export interface TeamMember {
  id: string
  tenantId: string
  userId: string | null
  email: string
  fullName: string | null
  role: TeamRole
  status: MemberStatus
  /** Null until their first successful sign-in — this is what "Invited" means on screen. */
  acceptedAt: string | null
  invitedAt: string | null
  createdAt: string
}

interface MemberRow {
  id: string
  tenant_id: string
  user_id: string | null
  invited_email: string | null
  full_name: string | null
  role: string
  status: string
  accepted_at: string | null
  invited_at: string | null
  created_at: string
}

const COLS = 'id, tenant_id, user_id, invited_email, full_name, role, status, accepted_at, invited_at, created_at'

function toMember(r: MemberRow): TeamMember {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    email: r.invited_email || '',
    fullName: r.full_name,
    role: isTeamRole(r.role) ? r.role : 'staff',
    status: (r.status as MemberStatus) || 'disabled',
    acceptedAt: r.accepted_at,
    invitedAt: r.invited_at,
    createdAt: r.created_at,
  }
}

/**
 * Is the membership table there yet?
 *
 * The migration is hand-run in the Supabase editor, so for some window the code is deployed and the
 * table is not. Every read below answers "no members" in that window rather than throwing, and the
 * resolver treats it as "owner-only, exactly as before" — so the two halves can ship in either order
 * without a minute of breakage for anyone. Same fail-soft posture as lib/db/capabilities.ts.
 */
function isMissingTable(code?: string): boolean {
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST106'
}

// ── RESOLUTION ──────────────────────────────────────────────────────────────────────────────────────

export interface ResolvedMembership {
  tenantId: string
  role: TeamRole
  memberId: string
}

/**
 * The business this user is a MEMBER of, if any. Called only after the owner lookup has come back
 * empty — membership never overrides ownership, in this file or in get_tenant_id(), so an owner's
 * resolution is bit-identical to what it was before teams existed.
 *
 * Returns null on a missing table, a missing row, or any error: the caller then behaves exactly as it
 * did before this feature, which is the only safe direction for a resolver to fail in.
 */
export async function resolveMembership(userId: string): Promise<ResolvedMembership | null> {
  try {
    const { data, error } = await createAdminClient()
      .from('tenant_members')
      .select('id, tenant_id, role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) {
      if (!isMissingTable(error.code)) console.error('[team] resolveMembership failed:', error.code, error.message)
      return null
    }
    if (!data) return null
    return { tenantId: data.tenant_id as string, role: isTeamRole(data.role) ? data.role : 'staff', memberId: data.id as string }
  } catch (err) {
    console.error('[team] resolveMembership threw:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Stamp first sign-in, so the Team screen can say "Active" instead of "Invited".
 *
 * Best-effort by design: this is a display detail, and a business must never fail to load because a
 * timestamp could not be written. The `is('accepted_at', null)` guard makes it a one-time write
 * rather than an update on every single request.
 */
export async function markAccepted(memberId: string): Promise<void> {
  try {
    await createAdminClient()
      .from('tenant_members')
      .update({ accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', memberId)
      .is('accepted_at', null)
  } catch { /* display only — never surface */ }
}

// ── READING THE TEAM ────────────────────────────────────────────────────────────────────────────────

export async function listMembers(tenantId: string): Promise<{ members: TeamMember[]; unavailable: boolean }> {
  const { data, error } = await createAdminClient()
    .from('tenant_members')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .neq('status', 'disabled')
    .order('created_at', { ascending: true })
  if (error) {
    if (isMissingTable(error.code)) return { members: [], unavailable: true }
    console.error('[team] listMembers failed:', error.code, error.message)
    return { members: [], unavailable: false }
  }
  return { members: (data as MemberRow[] | null ?? []).map(toMember), unavailable: false }
}

/** One member, scoped to the business — an id from another tenant resolves to null, never a row. */
export async function getMember(tenantId: string, memberId: string): Promise<TeamMember | null> {
  const { data } = await createAdminClient()
    .from('tenant_members').select(COLS).eq('id', memberId).eq('tenant_id', tenantId).maybeSingle()
  return data ? toMember(data as MemberRow) : null
}

// ── INVITING ────────────────────────────────────────────────────────────────────────────────────────

export type InviteError =
  | 'invalid_email'
  | 'invalid_role'
  | 'already_member'
  | 'active_elsewhere'
  | 'auth_failed'
  | 'db_failed'
  | 'unavailable'

export interface InviteResult {
  ok: boolean
  member?: TeamMember
  /** True when the invitation email went out. False means the seat exists but the mail failed. */
  emailed?: boolean
  error?: InviteError
}

/**
 * Create the auth user if they are new, or find them if they are not — and in both cases return a
 * single-use link that lets THEM choose their own password.
 *
 * generateLink is the same mechanism /api/auth/forgot-password already uses, and it is the reason this
 * feature stores no token of its own: Supabase mints it, we hand it straight to the mailer, and it is
 * never written to our database and never logged. The two link types are the whole idempotency story —
 * 'invite' creates, 'recovery' finds — so re-inviting somebody who already has a Scalix login attaches
 * the existing account rather than failing, which is what the current /api/invite/accept gets wrong
 * (it 409s on a known email and strands the person).
 */
async function ensureAuthUser(
  email: string,
  fullName: string | null,
  redirectTo: string,
): Promise<{ userId: string; link: string } | null> {
  const admin = createAdminClient()

  const invited = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo, data: fullName ? { full_name: fullName } : undefined },
  })
  if (!invited.error && invited.data?.user && invited.data.properties?.action_link) {
    return { userId: invited.data.user.id, link: invited.data.properties.action_link }
  }

  // Already has a Scalix login (they may be a customer of another business, or were invited before).
  // A recovery link lets them set a password on the account they already have.
  const existing = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
  if (!existing.error && existing.data?.user && existing.data.properties?.action_link) {
    return { userId: existing.data.user.id, link: existing.data.properties.action_link }
  }

  console.error('[team] could not mint an invite link:', invited.error?.message, existing.error?.message)
  return null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inviteEmailHtml(businessName: string, link: string): string {
  const name = escapeHtml(businessName)
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
      <div style="font-size:14px;font-weight:600;color:#374151">Scalix</div>
      <h1 style="font-size:20px;margin:12px 0 6px">You've been added to ${name}</h1>
      <p style="font-size:14px;color:#4b5563;margin:0 0 16px">Choose a password to activate your login. You'll then be able to sign in to ${name} on Scalix.</p>
      <a href="${link}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:10px">Set your password</a>
      <p style="font-size:12px;color:#9ca3af;margin:18px 0 0">If you weren't expecting this, you can ignore this email — nothing will change.</p>
    </div>
  </div></body></html>`
}

export interface InviteInput {
  tenantId: string
  businessName: string
  email: string
  fullName?: string | null
  role: TeamRole
  invitedBy: string
  /** Absolute origin of the app, for the password-setup redirect. */
  appUrl: string
}

/**
 * Add somebody to a business, or re-send to somebody already added.
 *
 * IDEMPOTENT in every direction that matters: same email twice updates the one row and re-sends;
 * an email that already has a Scalix account attaches it; a disabled member being re-invited is
 * reactivated rather than duplicated. There is deliberately no path here that creates a tenant.
 */
export async function inviteMember(input: InviteInput): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'invalid_email' }
  if (!isTeamRole(input.role) || input.role === 'owner') return { ok: false, error: 'invalid_role' }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const auth = await ensureAuthUser(email, input.fullName ?? null, `${input.appUrl}/auth/update-password`)
  if (!auth) return { ok: false, error: 'auth_failed' }

  // Already on this team? Update in place — role, name, and back to active if they'd been removed.
  const { data: existingRow, error: findErr } = await admin
    .from('tenant_members').select(COLS)
    .eq('tenant_id', input.tenantId).eq('user_id', auth.userId).maybeSingle()
  if (findErr && isMissingTable(findErr.code)) return { ok: false, error: 'unavailable' }

  let row: MemberRow | null = null
  if (existingRow) {
    const prev = existingRow as MemberRow
    // Never silently demote or re-grant the owner through the invite path.
    if (prev.role === 'owner') return { ok: false, error: 'already_member' }
    const { data, error } = await admin.from('tenant_members')
      .update({ role: input.role, status: 'active', invited_email: email, full_name: input.fullName ?? prev.full_name, invited_at: now, updated_at: now })
      .eq('id', prev.id).select(COLS).maybeSingle()
    if (error) { console.error('[team] invite update failed:', error.code, error.message); return { ok: false, error: 'db_failed' } }
    row = data as MemberRow
  } else {
    const { data, error } = await admin.from('tenant_members')
      .insert({
        tenant_id: input.tenantId, user_id: auth.userId, role: input.role, status: 'active',
        invited_email: email, full_name: input.fullName ?? null, invited_by: input.invitedBy, invited_at: now,
      })
      .select(COLS).maybeSingle()
    if (error) {
      if (isMissingTable(error.code)) return { ok: false, error: 'unavailable' }
      // uq_tenant_member_active_user — this person is already live inside a different business.
      if (error.code === '23505') return { ok: false, error: 'active_elsewhere' }
      console.error('[team] invite insert failed:', error.code, error.message)
      return { ok: false, error: 'db_failed' }
    }
    row = data as MemberRow
  }

  if (!row) return { ok: false, error: 'db_failed' }

  // The link is passed straight to the mailer and never logged — see ensureAuthUser.
  let emailed = false
  try {
    const { sendEmail } = await import('@/lib/email/send')
    await sendEmail(email, `You've been added to ${input.businessName} on Scalix`, inviteEmailHtml(input.businessName, auth.link))
    emailed = true
  } catch (err) {
    // The seat is real even if the mail bounced; the owner can re-send from the Team screen. Log the
    // failure WITHOUT the link.
    console.error('[team] invite email failed for', email, '—', err instanceof Error ? err.message : err)
  }

  return { ok: true, member: toMember(row), emailed }
}

// ── CHANGING AND REVOKING ───────────────────────────────────────────────────────────────────────────

/**
 * Deactivate a member. Their access is gone on their NEXT REQUEST — both the resolver and
 * get_tenant_id() read status='active', so there is no cached grant to wait out and no session to
 * hunt down.
 *
 * Deliberately a status flip, not a delete: the row is what `created_by` on an order points at, and
 * deleting it would turn a real audit trail into a dangling uuid.
 */
export async function deactivateMember(tenantId: string, memberId: string): Promise<boolean> {
  const { error } = await createAdminClient()
    .from('tenant_members')
    .update({ status: 'disabled', updated_at: new Date().toISOString() })
    .eq('id', memberId).eq('tenant_id', tenantId).neq('role', 'owner')
  if (error) { console.error('[team] deactivate failed:', error.code, error.message); return false }
  return true
}

export async function setMemberRole(tenantId: string, memberId: string, role: TeamRole): Promise<boolean> {
  if (!isTeamRole(role) || role === 'owner') return false
  const { error } = await createAdminClient()
    .from('tenant_members')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', memberId).eq('tenant_id', tenantId).neq('role', 'owner')
  if (error) { console.error('[team] setMemberRole failed:', error.code, error.message); return false }
  return true
}
