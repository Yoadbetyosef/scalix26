import { getPartnerContext } from '@/lib/partner/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { PageHeader, Panel, EmptyRow, money } from '@/components/partner/ui'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  signup: 'bg-gray-100 text-gray-600', trial: 'bg-amber-50 text-amber-700', paid: 'bg-green-50 text-green-700', churned: 'bg-red-50 text-red-600',
}

export default async function CustomersPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const db = createAdminClient()
  const { data: refs } = await db.from('referrals')
    .select('id, tenant_id, status, converted_at, created_at, tenants(business_name, plan)')
    .eq('partner_id', ctx.partnerId).neq('status', 'rejected').order('created_at', { ascending: false })

  const tenantIds = (refs || []).map((r) => r.tenant_id).filter(Boolean) as string[]
  const byTenant: Record<string, number> = {}
  if (tenantIds.length) {
    const { data: entries } = await db.from('commission_entries').select('tenant_id, amount_cents, status').eq('partner_id', ctx.partnerId).in('tenant_id', tenantIds)
    for (const e of entries || []) if (e.tenant_id) byTenant[e.tenant_id] = (byTenant[e.tenant_id] || 0) + (e.status === 'paid' ? e.amount_cents : 0)
  }

  return (
    <div>
      <PageHeader title="Customers" subtitle="Businesses you referred and their status." />
      <Panel>
        {!refs || refs.length === 0 ? (
          <EmptyRow>No referred customers yet. Share a referral link to get started.</EmptyRow>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Business</th><th className="py-2 pr-3 font-medium">Plan</th>
                <th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Signed up</th>
                <th className="py-2 font-medium text-right">Lifetime commission</th>
              </tr></thead>
              <tbody>
                {refs.map((r) => {
                  const t = r.tenants as unknown as { business_name?: string; plan?: string } | null
                  return (
                    <tr key={r.id} className="border-b border-hairline/60">
                      <td className="py-2.5 pr-3 font-medium text-ink">{t?.business_name || 'Unknown'}</td>
                      <td className="py-2.5 pr-3 capitalize text-subtle">{t?.plan || 'trial'}</td>
                      <td className="py-2.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status] || ''}`}>{r.status}</span></td>
                      <td className="py-2.5 pr-3 text-subtle">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td className="py-2.5 text-right font-medium text-ink">{money(byTenant[r.tenant_id as string] || 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
