import { createClient, createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Bot, Zap, Phone, MessageSquare, Mail, MessageCircle, Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import { employeeStatus } from '@/lib/employee'
import { FacebookIcon } from '@/components/icons/brand-icons'

// Matching icon for a channel chip — official brand logos for FB/IG, lucide for the
// generic channels. Display only.
// Apple-style channel colors — the icon tile carries the channel's identity.
const CHANNEL_TONE: Record<string, string> = {
  voice: 'bg-cyan-500', sms: 'bg-emerald-500', email: 'bg-violet-500',
  whatsapp: 'bg-green-500', facebook: 'bg-blue-600', instagram: 'bg-pink-500',
}

function channelIcon(type: string) {
  const cls = 'w-3 h-3'
  switch (type) {
    case 'voice': return <Phone className={cls} strokeWidth={1.75} />
    case 'sms': return <MessageSquare className={cls} strokeWidth={1.75} />
    case 'email': return <Mail className={cls} strokeWidth={1.75} />
    case 'whatsapp': return <MessageCircle className={cls} strokeWidth={1.75} />
    case 'facebook': return <FacebookIcon className={cls} color="#FFFFFF" />
    case 'instagram': return <Camera className={cls} strokeWidth={2} />
    default: return null
  }
}

const CHANNEL_LABELS: Record<string, string> = {
  voice: 'Voice', sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram',
}

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
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-8 gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-ink">AI Employees</h1>
          <p className="text-sm text-muted mt-1">
            {employees?.length
              ? `${employees.length} ${employees.length === 1 ? 'employee' : 'employees'} working for you`
              : 'Your digital team'}
          </p>
        </div>
        <Link href="/ai-employees/new" className="flex-shrink-0">
          <Button>
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New AI Employee</span>
            <span className="sm:hidden">New</span>
          </Button>
        </Link>
      </div>

      {!employees?.length ? (
        <EmptyState
          icon={Bot}
          title="Hire your first AI employee"
          action={
            <Link href="/ai-employees/new">
              <Button>
                <Plus className="w-4 h-4" />
                Create your first employee
              </Button>
            </Link>
          }
        >
          In a few minutes you&rsquo;ll have a digital employee answering every call, text, and message — working 24/7 so you never miss a customer.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sx-stagger">
          {employees.map(emp => {
            const live = emp.status === 'active'
            const channelCount = (emp.channels?.length || 0) + (emailAgentIds.has(emp.id) ? 1 : 0)
            const activeSkills = emp.skills?.filter((s: { active: boolean }) => s.active).length || 0
            const channels: { id: string; type: string }[] = [
              ...((emp.channels || []) as { id: string; type: string }[]),
              ...(emailAgentIds.has(emp.id) ? [{ id: `${emp.id}-email`, type: 'email' }] : []),
            ]
            return (
              <Card key={emp.id} className="group hover:shadow-e3 hover:-translate-y-0.5 transition-all duration-300">
                <CardContent className="p-6">
                  {/* Identity — the employee, alive */}
                  <div className="flex items-start gap-3.5 mb-6">
                    <EmployeeAvatar name={emp.name} voice={emp.voice} status={employeeStatus(emp.status)} size="md" />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <h3 className="text-base font-medium tracking-tight text-ink truncate">{emp.name}</h3>
                      <p className="mt-1 inline-flex items-center gap-1.5 text-xs">
                        <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-muted'}`} />
                        <span className={live ? 'text-emerald-600 font-medium' : 'text-muted'}>
                          {live ? 'On duty · watching every channel' : 'Draft · not live yet'}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* The work it carries — real figures, large and calm */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="rounded-2xl bg-sunken/60 px-4 py-3">
                      <p className="sx-tabular text-2xl font-light text-ink leading-none">{channelCount}</p>
                      <p className="text-[11px] uppercase tracking-wide text-muted mt-1.5">Channels</p>
                    </div>
                    <div className="rounded-2xl bg-sunken/60 px-4 py-3">
                      <p className="sx-tabular text-2xl font-light text-ink leading-none">{activeSkills}</p>
                      <p className="text-[11px] uppercase tracking-wide text-muted mt-1.5">Active skills</p>
                    </div>
                  </div>

                  {/* Connected channels — neutral chips, the channel icon does the talking */}
                  {channels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-6">
                      {channels.slice(0, 4).map((ch) => (
                        <span key={ch.id} className="inline-flex items-center gap-1.5 rounded-full bg-sunken py-1 pl-1 pr-2.5 text-xs font-medium text-ink">
                          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${CHANNEL_TONE[ch.type] || 'bg-muted'} text-white`}>{channelIcon(ch.type)}</span>
                          {CHANNEL_LABELS[ch.type] || ch.type}
                        </span>
                      ))}
                      {channels.length > 4 && (
                        <span className="inline-flex items-center rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-muted">+{channels.length - 4}</span>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Link href={`/ai-employees/${emp.id}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">Configure</Button>
                    </Link>
                    {emp.status === 'draft' && (
                      <Button size="sm" className="flex-shrink-0">
                        <Zap className="w-3.5 h-3.5" />Go Live
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
