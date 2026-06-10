import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Phone, MessageSquare, MessageCircle, Bot, Plus, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, truncate } from '@/lib/utils'
import { ConversationDistributionChart } from '@/components/charts/conversation-distribution'
import { ChannelDistributionChart } from '@/components/charts/channel-distribution'
import { LeadsTable } from '@/components/dashboard/leads-table'
import type { Lead } from '@/types'

async function getDashboardData(tenantId: string) {
  const supabase = await createClient()

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: totalCalls },
    { count: totalSMS },
    { count: totalConversations },
    { count: leads },
    { data: conversations },
    { data: aiEmployees },
    { data: leadRecords },
  ] = await Promise.all([
    supabase.from('analytics_events').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('event_type', 'call_handled').gte('created_at', sevenDaysAgo),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('event_type', 'message_handled').gte('created_at', sevenDaysAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).gte('created_at', sevenDaysAgo),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('event_type', 'lead_captured').gte('created_at', sevenDaysAgo),
    supabase.from('conversations')
      .select('*, contact:contacts(name, phone)')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase.from('ai_employees')
      .select('*, channels(*), skills(*)')
      .eq('tenant_id', tenantId),
    // Leads — resilient: if the table doesn't exist yet, data is null -> []
    supabase.from('leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  return {
    stats: {
      totalCalls: totalCalls || 0,
      textMessages: totalSMS || 0,
      totalConversations: totalConversations || 0,
      leads: leads || 0,
    },
    conversations: conversations || [],
    aiEmployees: aiEmployees || [],
    leads_list: (leadRecords as Lead[] | null) || [],
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const activeTab = tab === 'leads' ? 'leads' : 'overview'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Use service client to bypass RLS for tenant lookup
  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tenant) redirect('/setup')

  const { stats, conversations, aiEmployees, leads_list } = await getDashboardData(tenant.id)

  const statCards = [
    { label: 'Total Calls', value: stats.totalCalls, icon: Phone, color: 'bg-purple-50 text-purple-600' },
    { label: 'Text Messages', value: stats.textMessages, icon: MessageSquare, color: 'bg-blue-50 text-blue-600' },
    { label: 'Live Chat', value: stats.totalConversations, icon: MessageCircle, color: 'bg-teal-50 text-[#4ecdc4]' },
    { label: 'Leads Generated', value: stats.leads, icon: TrendingUp, color: 'bg-green-50 text-green-600' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5 truncate">{tenant.business_name} · Last 7 days</p>
        </div>
        <Link href="/ai-employees/new" className="flex-shrink-0">
          <Button className="gap-2 text-sm">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New AI Employee</span>
            <span className="sm:hidden">New</span>
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <Link
          href="/dashboard"
          className={`tap-target inline-block px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'overview' ? 'border-[#4ecdc4] text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Overview
        </Link>
        <Link
          href="/dashboard?tab=leads"
          className={`tap-target inline-block px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'leads' ? 'border-[#4ecdc4] text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Leads
        </Link>
      </div>

      {activeTab === 'leads' ? (
        <LeadsTable leads={leads_list} />
      ) : (
      <>
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">{label}</span>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Conversation Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ConversationDistributionChart tenantId={tenant.id} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Channel Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ChannelDistributionChart conversations={conversations} />
          </CardContent>
        </Card>
      </div>

      {/* AI Employees + Inbox Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AI Employees */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle>AI Employees</CardTitle>
            <Link href="/ai-employees/new">
              <Button variant="outline" size="sm">
                <Plus className="w-3.5 h-3.5 mr-1" />Add
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            {aiEmployees.length === 0 ? (
              <div className="text-center py-8">
                <Bot className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">No AI employees yet</p>
                <Link href="/ai-employees/new">
                  <Button className="mt-3" size="sm">Create Your First AI Employee</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {aiEmployees.map((emp) => (
                  <div key={emp.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50">
                    <div className="w-9 h-9 rounded-full bg-[#4ecdc4] flex items-center justify-center text-white text-sm font-bold">
                      {emp.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{emp.name}</p>
                      <p className="text-xs text-gray-500">{emp.channels?.length || 0} channels · {emp.skills?.filter((s: { active: boolean }) => s.active).length || 0} skills</p>
                    </div>
                    <Badge variant={emp.status as 'active' | 'draft'}>{emp.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Inbox Preview */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle>Recent Conversations</CardTitle>
            <Link href="/inbox">
              <Button variant="outline" size="sm">View All</Button>
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            {conversations.length === 0 ? (
              <div className="text-center py-8">
                <MessageCircle className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">No conversations yet</p>
                <p className="text-gray-400 text-xs mt-1">They&apos;ll appear here once customers reach out</p>
              </div>
            ) : (
              <div className="space-y-2">
                {conversations.slice(0, 6).map((conv) => (
                  <Link key={conv.id} href={`/inbox/${conv.id}`} className="tap-target block">
                    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-xs font-medium">
                        {(conv.contact as { name?: string; phone?: string } | null)?.name?.[0] || (conv.contact as { name?: string; phone?: string } | null)?.phone?.[0] || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {(conv.contact as { name?: string; phone?: string } | null)?.name || (conv.contact as { name?: string; phone?: string } | null)?.phone || 'Unknown'}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {conv.summary ? truncate(conv.summary, 50) : `${conv.channel} conversation`}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
                        <p className="text-xs text-gray-400 mt-1">{formatDateTime(conv.updated_at)}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </>
      )}
    </div>
  )
}
