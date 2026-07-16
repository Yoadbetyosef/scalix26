import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { listProjects } from '@/lib/commerce/projects'
import { ProjectForm } from '@/components/commerce/project-form'

export const dynamic = 'force-dynamic'
const STATUS: Record<string, string> = { planning: 'bg-gray-100 text-gray-700', in_design: 'bg-blue-100 text-blue-700', proposal_sent: 'bg-amber-100 text-amber-700', won: 'bg-emerald-100 text-emerald-700', lost: 'bg-gray-100 text-gray-500', completed: 'bg-emerald-100 text-emerald-700' }

export default async function ProjectsPage() {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const projects = await listProjects()
  return (
    <div className="mx-auto max-w-5xl px-6 pb-10">
      <div className="mb-5 flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold text-gray-900">Projects</h1><p className="text-sm text-gray-500">{projects.length} project{projects.length === 1 ? '' : 's'}</p></div>
        <ProjectForm />
      </div>
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">No projects yet. A project holds a customer’s rooms, mood boards, drafts, and orders.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {projects.map((p) => (
            <div key={p.id as string} className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
              <span className="font-mono text-xs text-gray-500">{p.project_number as string}</span>
              <span className="text-gray-900">{p.name as string}</span>
              {p.customer_name ? <span className="text-sm text-gray-500">· {p.customer_name as string}</span> : null}
              <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[p.status as string] ?? 'bg-gray-100 text-gray-600'}`}>{(p.status as string).replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
