import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isAdminEmail } from './emails'

// Team roles for the internal admin platform. Stored in the admin_users table; the platform
// owner (hardcoded super-admin / ADMIN_EMAILS) always resolves to super_admin so a bad DB
// state can never lock them out.
export type AdminRole = 'super_admin' | 'support' | 'sales' | 'developer' | 'read_only'

export const ROLES: { key: AdminRole; label: string }[] = [
  { key: 'super_admin', label: 'Super Admin' },
  { key: 'support', label: 'Support' },
  { key: 'sales', label: 'Sales' },
  { key: 'developer', label: 'Developer' },
  { key: 'read_only', label: 'Read Only' },
]

export interface AdminContext { email: string; role: AdminRole }

/** Resolve the current user's admin context, or null if they are not an admin. */
export async function getAdminContext(): Promise<AdminContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email?.toLowerCase()
  if (!email) return null

  const svc = createAdminClient() // service-role: admin_users is RLS-locked
  const { data } = await svc.from('admin_users').select('role').eq('email', email).maybeSingle()
  if (data?.role) return { email, role: data.role as AdminRole }

  // Owner / env-configured admins with no explicit row default to super_admin.
  if (isAdminEmail(email)) return { email, role: 'super_admin' }
  return null
}

// Capability checks. Read Only can view everything but mutate nothing.
export const canWrite = (r: AdminRole) => r !== 'read_only'
export const canManageModules = (r: AdminRole) => r === 'super_admin' || r === 'developer'
export const canImpersonate = (r: AdminRole) => r === 'super_admin' || r === 'support'
export const canManageSecurity = (r: AdminRole) => r === 'super_admin'
