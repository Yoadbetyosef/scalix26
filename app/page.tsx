import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPartnerContext } from '@/lib/partner/rbac'

// The single post-auth entry point. Decides which PLANE a signed-in user belongs to:
//   • Active partner (any type) → the partner console at /partner. /partner itself routes
//     white_label/reseller partners to /partner/setup when setup isn't complete (else the
//     wholesale dashboard), and revenue-share partners to their commission dashboard.
//   • Everyone else (regular business users) → the business app at /dashboard.
// The login page redirects here (not straight to /dashboard) so this decision is never bypassed.
export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // getPartnerContext resolves an ACTIVE partner_member for this user via the admin client
  // (partner tables are RLS-locked). Non-null ⇒ this user belongs to a Partner account.
  const ctx = await getPartnerContext()
  if (ctx) redirect('/partner')

  redirect('/dashboard')
}
