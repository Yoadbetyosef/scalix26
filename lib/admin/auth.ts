import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from './emails'

// Re-export so existing imports of `isAdminEmail` from '@/lib/admin/auth' keep working.
export { isAdminEmail } from './emails'

export async function isAdmin(_req?: NextRequest): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return isAdminEmail(user?.email)
}
