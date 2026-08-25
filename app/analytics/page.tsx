import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { readAnalytics } from '@/lib/analytics/read'
import { redirect } from 'next/navigation'
import { AnalyticsCharts } from '@/components/charts/analytics-charts'

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Active-workspace aware (owner tenant, or the client tenant a WL partner is operating). readAnalytics
  // opens its own admin client and takes the server-validated tenantId as its sole scope; the RLS cookie
  // client would resolve to the operator's own tenant. An unused createAdminClient() binding sat here
  // before the migration and went with its import.
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')

  // Moved to lib/analytics/read.ts so a second screen can read the same figures. Same window, same
  // three queries, same derivations — see that file's header.
  const { total, fcr, avgDuration, conversations } = await readAnalytics(tenantId)

  return (
    <div className="v2 v2-embedded p-4 sm:p-6 max-md:pb-16">
      {/* No page title: the rail says Analytics. The micro-label carries the window, which is the one
          thing the rail cannot say. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />AI employee performance · last 30 days</p>
        <s />
      </div>

      {/* FOUR FIGURES, NOT FOUR CARDS. v1 boxed each one and gave it a filled icon tile in its own
          brand colour — four surfaces and four colours to present four numbers, which is the shape
          that makes a dashboard read as decoration. The number is the content; its mono label names
          it and a caption qualifies it. /v2 designed this grid for exactly this job.

          A FIGURE THAT DOES NOT EXIST IS OMITTED, NEVER ZEROED. With no conversations there is no
          average handle time to report, and printing "0m 0s" claims a measurement nobody made —
          v1 printed it. */}
      <dl className="v2-figgrid">
        <div>
          <dt className="v2-figlab">Conversations</dt>
          <dd className="v2-fignum">{total.toLocaleString()}</dd>
          <p className="v2-fignote">In the last 30 days</p>
        </div>
        <div>
          <dt className="v2-figlab">Settled without a person</dt>
          <dd className="v2-fignum">{total > 0 ? `${fcr}%` : '—'}</dd>
          <p className="v2-fignote">{total > 0 ? 'Resolved by the AI, never transferred' : 'Nothing to resolve yet'}</p>
        </div>
        <div>
          <dt className="v2-figlab">Average handle time</dt>
          <dd className="v2-fignum">{avgDuration > 0 ? `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s` : '—'}</dd>
          <p className="v2-fignote">{avgDuration > 0 ? 'Per conversation' : 'No timed conversations yet'}</p>
        </div>
        <div>
          <dt className="v2-figlab">Handed to a person</dt>
          <dd className="v2-fignum">{total > 0 ? Math.round(total * (100 - fcr) / 100).toLocaleString() : '—'}</dd>
          <p className="v2-fignote">{total > 0 ? 'The rest reached you' : 'Nothing has come in yet'}</p>
        </div>
      </dl>

      <AnalyticsCharts tenantId={tenantId} conversations={conversations || []} />
    </div>
  )
}
