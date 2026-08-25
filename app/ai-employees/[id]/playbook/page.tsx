import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { PlaybookClient } from '@/components/ai-employees/playbook/playbook-client'

export default async function PlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Admin client (operator-safe; createServiceClient would RLS-scope to the partner's own tenant).
  const service = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/setup')

  const { data: employee } = await service
    .from('ai_employees').select('id, name').eq('id', id).eq('tenant_id', tenantId).single()
  if (!employee) notFound()

  return (
    <div className="v2 v2-embedded p-4 sm:p-6 max-w-3xl">
      <div className="v2-head">
        <Link href={`/ai-employees/${id}`} className="v2-act tap-target">
          <ChevronLeft className="w-3.5 h-3.5" /> {employee.name || 'AI employee'}
        </Link>
        <s />
      </div>
      <PlaybookClient agentId={employee.id} agentName={employee.name || 'Amy'} />
    </div>
  )
}
