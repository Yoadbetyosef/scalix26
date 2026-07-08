import { Panel } from '@/components/partner/ui'

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: 'GET', path: '/api/partner/me', desc: 'Your partner profile' },
  { method: 'GET', path: '/api/partner/links', desc: 'List referral links' },
  { method: 'POST', path: '/api/partner/links', desc: 'Create a referral link (write)' },
  { method: 'GET', path: '/api/partner/referrals', desc: 'Attributed customers' },
  { method: 'GET', path: '/api/partner/commissions', desc: 'Commission ledger + payouts' },
  { method: 'GET', path: '/api/partner/customers', desc: 'Referred customers' },
  { method: 'GET', path: '/api/partner/crm/leads', desc: 'CRM leads' },
  { method: 'POST', path: '/api/partner/crm/leads', desc: 'Create a lead (write)' },
  { method: 'GET', path: '/api/partner/demos', desc: 'List demos' },
  { method: 'POST', path: '/api/partner/demos', desc: 'Generate a demo (write)' },
  { method: 'GET', path: '/api/partner/analytics', desc: 'Funnel + earnings + top links' },
]

export function ApiDocs() {
  return (
    <Panel title="API reference">
      <p className="mb-3 text-sm text-subtle">
        Authenticate with an API key from above: send header{' '}
        <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs">Authorization: Bearer pk_live_…</code>.
        Read scope allows GET; write scope is required for POST/PATCH/DELETE.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.method + e.path} className="border-b border-hairline/60">
                <td className="py-2 pr-3"><span className={`rounded px-1.5 py-0.5 text-xs font-bold ${e.method === 'GET' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>{e.method}</span></td>
                <td className="py-2 pr-3 font-mono text-xs text-ink">{e.path}</td>
                <td className="py-2 text-subtle">{e.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
