import { createClient, createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Bot, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default async function AIEmployeesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase.from('tenants').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  const { data: employees } = await supabase
    .from('ai_employees')
    .select('*, channels(*), skills(*)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })

  // Email connection lives in connected_email_accounts (per-agent), NOT in the
  // channels table — so the card's count/badges miss it. Read which agents have a
  // connected email account (admin read, scoped to this verified tenant).
  const { data: emailAccounts } = await createAdminClient()
    .from('connected_email_accounts')
    .select('ai_employee_id')
    .eq('tenant_id', tenant.id)
    .eq('status', 'connected')
  const emailAgentIds = new Set((emailAccounts || []).map((a) => a.ai_employee_id).filter(Boolean))

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">AI Employees</h1>
          <p className="text-sm text-gray-500 mt-0.5">{employees?.length || 0} employees</p>
        </div>
        <Link href="/ai-employees/new" className="flex-shrink-0">
          <Button>
            <Plus className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">New AI Employee</span>
            <span className="sm:hidden">New</span>
          </Button>
        </Link>
      </div>

      {!employees?.length ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <Bot className="w-12 h-12 mb-3" />
          <p className="text-sm font-medium">No AI employees yet</p>
          <p className="text-xs mt-1">Create your first AI employee to start handling customer communications</p>
          <Link href="/ai-employees/new">
            <Button className="mt-4">
              <Plus className="w-4 h-4 mr-1.5" />
              Create AI Employee
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {employees.map(emp => (
            <Card key={emp.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-[#4ecdc4]/10 flex items-center justify-center text-[#4ecdc4] text-lg font-bold flex-shrink-0">
                    {emp.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{emp.name}</h3>
                      <Badge variant={emp.status as 'active' | 'draft'}>{emp.status}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{emp.greeting}</p>
                  </div>
                </div>

                <div className="space-y-2 text-xs text-gray-500 mb-4">
                  <div className="flex items-center justify-between">
                    <span>Channels</span>
                    <span className="font-medium text-gray-700">{(emp.channels?.length || 0) + (emailAgentIds.has(emp.id) ? 1 : 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Active Skills</span>
                    <span className="font-medium text-gray-700">{emp.skills?.filter((s: { active: boolean }) => s.active).length || 0}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mb-4">
                  {(emp.channels || []).slice(0, 3).map((ch: { id: string; type: string }) => (
                    <Badge key={ch.id} variant={ch.type as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>
                      {ch.type}
                    </Badge>
                  ))}
                  {/* Email connection isn't a channels row — add its pill when connected. */}
                  {emailAgentIds.has(emp.id) && <Badge variant="email">email</Badge>}
                </div>

                <div className="flex gap-2">
                  <Link href={`/ai-employees/${emp.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">Edit</Button>
                  </Link>
                  {emp.status === 'draft' && (
                    <Button size="sm" className="flex-shrink-0">
                      <Zap className="w-3.5 h-3.5 mr-1" />Go Live
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
