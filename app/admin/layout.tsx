import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/admin/rbac'
import { isFounderEmail } from '@/lib/admin/emails'
import { commandCenterEnabled } from '@/lib/command-center/guard'
import { AdminNav } from '@/components/admin/admin-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext()
  if (!ctx) redirect('/dashboard')

  // Founder-only CEO Command Center nav entry — shown only when the flag is on AND the viewer is a founder.
  const showCommandCenter = commandCenterEnabled() && isFounderEmail(ctx.email)

  return (
    <div className="min-h-screen bg-sunken">
      <AdminNav email={ctx.email} role={ctx.role} showCommandCenter={showCommandCenter} />
      <main className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
    </div>
  )
}
