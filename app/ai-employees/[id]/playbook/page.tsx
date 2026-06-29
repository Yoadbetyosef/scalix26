import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { PlaybookClient } from '@/components/ai-employees/playbook/playbook-client'

export default async function PlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const service = await createServiceClient()
  const { data: tenant } = await service
    .from('tenants').select('id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!tenant) redirect('/setup')

  const { data: employee } = await service
    .from('ai_employees').select('id, name').eq('id', id).eq('tenant_id', tenant.id).single()
  if (!employee) notFound()

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <Link
        href={`/ai-employees/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-subtle transition-colors hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" /> Back to {employee.name || 'AI employee'}
      </Link>
      <PlaybookClient agentId={employee.id} agentName={employee.name || 'Amy'} />
    </div>
  )
}
