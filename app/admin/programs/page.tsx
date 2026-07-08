import { getAdminContext } from '@/lib/admin/rbac'
import { redirect } from 'next/navigation'
import { AdminPrograms } from '@/components/admin/admin-programs'

export const dynamic = 'force-dynamic'

export default async function AdminProgramsPage() {
  const ctx = await getAdminContext()
  if (!ctx) redirect('/dashboard')
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-gray-900">Programs</h1>
      <p className="mb-5 text-sm text-gray-500">Commission plans and bonus campaigns for your partners.</p>
      <AdminPrograms canWrite={ctx.role !== 'read_only'} />
    </div>
  )
}
