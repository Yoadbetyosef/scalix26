import { redirect } from 'next/navigation'
import { requireCore } from '@/lib/core/guard'
import { getPreviewRenderable } from '@/lib/core/proposal-render'
import { logPreview } from '@/lib/core/proposals'
import { ProposalDocument } from '@/components/commerce/proposal-document'
import { ProposalPreviewBar } from '@/components/commerce/proposal-preview-bar'

// Authenticated INTERNAL preview — renders the exact customer document for any status (incl. Draft) without a
// token and without recording a customer view. Tenant-scoped via requireCore + getPreviewRenderable.
export const dynamic = 'force-dynamic'

export default async function ProposalPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) redirect('/auth/login')
  const { id } = await params
  const p = await getPreviewRenderable(c.tenantId, id)
  if (!p) {
    return (
      <main style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
          <p style={{ fontWeight: 600, color: '#111827' }}>Preview unavailable</p>
          <p style={{ fontSize: 14, marginTop: 4 }}>This proposal could not be found for your business, or is a legacy record.</p>
        </div>
      </main>
    )
  }
  await logPreview(c.tenantId, id, c.actor)
  return (
    <main style={{ minHeight: '100vh', background: '#f6f7f9', padding: '24px 16px' }} className="print:bg-white print:p-0">
      <ProposalPreviewBar />
      <ProposalDocument proposal={p} />
    </main>
  )
}
