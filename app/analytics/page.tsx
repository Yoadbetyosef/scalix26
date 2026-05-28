import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnalyticsCharts } from '@/components/charts/analytics-charts'

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).single()
  if (!tenant) redirect('/auth/signup')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: totalConversations },
    { count: resolvedConversations },
    { data: conversations },
  ] = await Promise.all([
    supabase.from('conversations').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).gte('created_at', thirtyDaysAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).eq('status', 'resolved').gte('created_at', thirtyDaysAgo),
    supabase.from('conversations').select('channel, status, created_at, duration_seconds')
      .eq('tenant_id', tenant.id).gte('created_at', thirtyDaysAgo),
  ])

  const total = totalConversations || 0
  const resolved = resolvedConversations || 0
  const fcr = total > 0 ? Math.round((resolved / total) * 100) : 0

  const avgDuration = conversations?.length
    ? Math.round(conversations.filter(c => c.duration_seconds).reduce((a, c) => a + (c.duration_seconds || 0), 0) / conversations.length)
    : 0

  const stats = [
    { label: 'Total Conversations', value: total.toLocaleString(), sub: 'Last 30 days' },
    { label: 'First Contact Resolution', value: `${fcr}%`, sub: 'AI resolved without transfer' },
    { label: 'Avg Handle Time', value: `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s`, sub: 'Per conversation' },
    { label: 'AI Handled', value: `${fcr}%`, sub: 'vs transferred to human' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">AI Employee performance — last 30 days</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, sub }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AnalyticsCharts tenantId={tenant.id} conversations={conversations || []} />
    </div>
  )
}
