import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { readAgents } from '@/lib/agents/list-read'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Zap } from 'lucide-react'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import { employeeStatus } from '@/lib/employee'
import { channelHue } from '@/app/(v2)/v2/channels'

const CHANNEL_LABELS: Record<string, string> = {
  voice: 'Voice', sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram',
}

export default async function AIEmployeesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Operator-safe by construction: readAgents opens its own admin client (not createServiceClient,
  // which would RLS-scope to the partner's own tenant) and takes the server-validated tenantId as its
  // sole scope. An unused `createAdminClient()` binding sat here before the migration; it went with
  // the import rather than staying to fail lint.
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')

  // Moved to lib/agents/list-read.ts so /v2's AI Employees screen reads the same rows. Same queries,
  // same join, same ordering — see that file's header.
  const { employees, emailAgentIds } = await readAgents(tenantId)

  return (
    <div className="v2 v2-embedded p-4 sm:p-6 max-w-6xl mx-auto max-md:pb-16">
      {/* No page title: the rail says AI Employees. The micro-label carries the count. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
          <i />
          {employees?.length
            ? `Your digital team · ${employees.length}`
            : 'Your digital team'}
        </p>
        <s />
        <Link href="/ai-employees/new" className="v2-act tap-target" data-solid>
          <Plus className="w-3.5 h-3.5" /> New AI employee
        </Link>
      </div>

      {!employees?.length ? (
        <div className="v2-card" data-empty>
          <b>Hire your first AI employee</b>
          <span>In a few minutes you’ll have a digital employee answering every call, text and message — working 24/7 so you never miss a customer.</span>
          <Link href="/ai-employees/new" className="v2-act" data-solid style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            <Plus className="w-3.5 h-3.5" /> Create your first employee
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sx-stagger">
          {employees.map(emp => {
            const live = emp.status === 'active'
            const channelCount = (emp.channels?.length || 0) + (emailAgentIds.has(emp.id) ? 1 : 0)
            const activeSkills = emp.skills?.filter((s: { active: boolean }) => s.active).length || 0
            const channels: { id: string; type: string }[] = [
              ...((emp.channels || []) as { id: string; type: string }[]),
              ...(emailAgentIds.has(emp.id) ? [{ id: `${emp.id}-email`, type: 'email' }] : []),
            ]
            // Display-level dedupe: one chip per unique channel type (data unchanged).
            const uniqueChannels = [...new Map(channels.map((ch) => [ch.type, ch])).values()]
            return (
              <div key={emp.id} className="v2-card" style={{ ['--chan' as string]: live ? 'var(--v2-t1)' : 'var(--v2-mute)', padding: 18 }}>
                {/* Identity. THE ROBOT, not a stock headshot of the chosen voice — the same face the
                    dashboard hero, the inbox rows and Ask Amy already show. An employee whose picture
                    changed when its voice dropdown changed was never an identity. */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13, marginBottom: 18 }}>
                  <EmployeeAvatar name={emp.name} voice={emp.voice} status={employeeStatus(emp.status)} size="md" />
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                    <p style={{ fontSize: 16, fontWeight: 550, letterSpacing: '-0.01em', color: 'var(--v2-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</p>
                    {/* Live is the one transient state on this screen, so it takes the live signal —
                        the dot and its ink — and a draft simply does not light up. */}
                    <p className="v2-kick" style={{ marginTop: 5, ['--ghue' as string]: live ? 'var(--v2-live)' : 'var(--v2-mute)' }}>
                      <i />{live ? 'On duty' : 'Draft — not live'}
                    </p>
                  </div>
                </div>

                {/* The work it carries. Two grey boxes became two figures on the totals row — the
                    number is the content and the word is its mono label. */}
                <dl className="v2-tot" style={{ justifyContent: 'flex-start', padding: 0, marginBottom: 16 }}>
                  <div><dt>Channels</dt><dd>{channelCount}</dd></div>
                  <div><dt>Active skills</dt><dd>{activeSkills}</dd></div>
                </dl>

                {/* Connected channels. v1 gave each one a filled brand-coloured icon tile inside a
                    grey pill — two surfaces and a sixth palette per chip. The chip already takes a
                    hue from --chan, and channels already have canonical hues, so the dot is the
                    identity and the word is the word. */}
                {uniqueChannels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" style={{ marginBottom: 16 }}>
                    {uniqueChannels.slice(0, 4).map((ch) => (
                      <span key={ch.id} className="v2-stat" style={{ ['--chan' as string]: channelHue(ch.type) }}>
                        <i className="v2-gdot" style={{ ['--ghue' as string]: channelHue(ch.type) }} />
                        {CHANNEL_LABELS[ch.type] || ch.type}
                      </span>
                    ))}
                    {uniqueChannels.length > 4 && (
                      <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>+{uniqueChannels.length - 4}</span>
                    )}
                  </div>
                )}

                <div className="v2-bar">
                  <Link href={`/ai-employees/${emp.id}`} className="v2-act tap-target" data-wide>Configure</Link>
                  {emp.status === 'draft' && (
                    <button className="v2-act tap-target" data-solid><Zap className="w-3.5 h-3.5" /> Go live</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
