import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { readAnalytics } from '@/lib/analytics/read'
import { redirect } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { MessagesSquare, CheckCircle2, Clock, Bot } from 'lucide-react'
import { AnalyticsCharts } from '@/components/charts/analytics-charts'

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Active-workspace aware (owner tenant, or the client tenant a WL partner is operating) + admin client
  // with explicit tenant_id scoping. The RLS cookie client would resolve to the operator's own tenant.
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')
  const tenant = { id: tenantId }
  const db = createAdminClient()

  // Moved to lib/analytics/read.ts so a second screen can read the same figures. Same window, same
  // three queries, same derivations — see that file's header.
  const { total, fcr, avgDuration, conversations } = await readAnalytics(tenantId)

  const stats = [
    { label: 'Total Conversations', value: total.toLocaleString(), sub: 'Last 30 days', icon: MessagesSquare, tone: 'bg-blue-500' },
    { label: 'First Contact Resolution', value: `${fcr}%`, sub: 'AI resolved without transfer', icon: CheckCircle2, tone: 'bg-emerald-500' },
    { label: 'Avg Handle Time', value: `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s`, sub: 'Per conversation', icon: Clock, tone: 'bg-amber-500' },
    { label: 'AI Handled', value: `${fcr}%`, sub: 'vs transferred to human', icon: Bot, tone: 'bg-violet-500' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-ink">Analytics</h1>
        <p className="text-sm text-muted mt-1">AI Employee performance — last 30 days</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sx-stagger">
        {stats.map(({ label, value, sub, icon: Icon, tone }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className={`w-9 h-9 rounded-xl ${tone} flex items-center justify-center text-white shadow-e1 mb-3`}>
                <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
              </div>
              <p className="sx-tabular text-2xl sm:text-3xl font-light tracking-tight text-ink leading-none">{value}</p>
              <p className="text-xs font-medium text-subtle mt-2">{label}</p>
              <p className="text-xs text-muted mt-0.5">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AnalyticsCharts tenantId={tenant.id} conversations={conversations || []} />
    </div>
  )
}
