import { notFound } from 'next/navigation'
import { resolvePublicProposal } from '@/lib/core/proposals'
import { looksLikeToken } from '@/lib/core/proposal-token'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { ProposalDocument } from '@/components/commerce/proposal-document'
import { ProposalPublicActions } from '@/components/commerce/proposal-public-actions'

// PUBLIC customer-facing proposal page. No auth — the token in the URL is the sole credential (hashed +
// validated server-side, revocable). Records a view on render UNLESS an authenticated owner of the tenant is
// previewing (internal preview must never inflate customer view tracking). Customer-safe data only.
export const dynamic = 'force-dynamic'

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!looksLikeToken(token)) notFound()
  const ctx = await requireActiveBusinessContext().catch(() => null)
  const p = await resolvePublicProposal(token, { recordView: true, internalTenantId: ctx?.tenantId ?? null })
  if (!p) notFound()

  return (
    <main style={{ minHeight: '100vh', background: '#f6f7f9', padding: '32px 16px' }} className="print:bg-white print:p-0">
      <ProposalDocument proposal={p} />
      <div style={{ maxWidth: 720, margin: '16px auto 0' }}>
        <ProposalPublicActions token={token} done={!p.canRespond} expired={p.is_expired} status={p.status} />
        <p className="print:hidden" style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 24 }}>Powered by Scalix</p>
      </div>
    </main>
  )
}
