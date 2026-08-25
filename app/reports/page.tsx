import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect } from 'next/navigation'
import { Activity, Bot, TrendingUp, Calendar } from 'lucide-react'
import { ReportBuilder } from '@/components/reports/report-builder'
import { REPORT_TEMPLATES } from '@/lib/reports/templates'

// The icon stays here because it is this screen's presentation; the id, name and description are the
// report and live in lib/reports/templates so /v2 lists the same four. The `tone` that used to sit
// beside each icon — four brand backgrounds for four filled tiles — went with the migration: one hue
// per section, and the drawing tells them apart.
const TEMPLATE_ICON: Record<string, typeof Activity> = {
  platform_usage: Activity,
  ai_productivity: Bot,
  lead_generation: TrendingUp,
  appointment_report: Calendar,
}

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Active workspace (owner tenant, or the client tenant a WL partner is operating). The export API
  // re-resolves + reads server-side; this just gates access and provides the id for the client prop.
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')

  return (
    <div className="v2 v2-embedded p-4 sm:p-6 max-w-3xl max-md:pb-16">
      {/* No page title: the rail says Reports. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Ready to run · {REPORT_TEMPLATES.length}</p>
        <s />
      </div>

      {/* THE FOUR TEMPLATES, AND NO BUTTONS ON THEM. Each card carried "View Report" and a download
          icon; neither had a handler, so all eight controls did nothing. Rendering them as .v2-act
          would have made eight dead verbs look like live ones — the behaviour is identical either
          way, and this way the page stops promising what it never delivered. The one control that
          does work is the exporter below, which is real and unchanged. Recorded as §37. */}
      <div className="v2-list" style={{ marginBottom: 34 }}>
        {REPORT_TEMPLATES.map((t) => {
          const Icon = TEMPLATE_ICON[t.id] ?? Activity
          return (
            <div key={t.id} className="v2-row" style={{ ['--chan' as string]: 'var(--v2-t3)' }}>
              <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><Icon /></span>
              <div className="v2-m">
                <p><span className="truncate">{t.name}</span></p>
                <span>{t.description}</span>
              </div>
            </div>
          )
        })}
      </div>

      <ReportBuilder tenantId={tenantId} />
    </div>
  )
}
