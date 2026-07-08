import { getAdminContext } from '@/lib/admin/rbac'
import { redirect } from 'next/navigation'
import { AdminPartners } from '@/components/admin/admin-partners'

export const dynamic = 'force-dynamic'

export default async function AdminPartnersPage() {
  const ctx = await getAdminContext()
  if (!ctx) redirect('/dashboard')
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-gray-900">Partners</h1>
      <p className="mb-5 text-sm text-gray-500">Distribution partners, their customers, and commission payouts.</p>
      <AdminPartners canWrite={ctx.role !== 'read_only'} />
    </div>
  )
}
