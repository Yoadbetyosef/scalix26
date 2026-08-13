import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, Activity, Bot, TrendingUp, Calendar } from 'lucide-react'
import { ReportBuilder } from '@/components/reports/report-builder'
import { REPORT_TEMPLATES } from '@/lib/reports/templates'

// Names and descriptions come from lib/reports/templates.ts so /v2 lists the same four; the icon and
// the tone stay here, because they are this screen's presentation and v2 draws its own.
const TEMPLATE_STYLE: Record<string, { icon: typeof Activity; tone: string }> = {
  platform_usage: { icon: Activity, tone: 'bg-blue-500' },
  ai_productivity: { icon: Bot, tone: 'bg-violet-500' },
  lead_generation: { icon: TrendingUp, tone: 'bg-emerald-500' },
  appointment_report: { icon: Calendar, tone: 'bg-orange-500' },
}

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Active workspace (owner tenant, or the client tenant a WL partner is operating). The export API
  // re-resolves + reads server-side; this just gates access and provides the id for the client prop.
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')
  const tenant = { id: tenantId }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-ink">Reports</h1>
        <p className="text-sm text-muted mt-1">Build and export custom reports</p>
      </div>

      {/* Templates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sx-stagger">
        {REPORT_TEMPLATES.map(template => {
          const Icon = TEMPLATE_STYLE[template.id].icon
          return (
          <Card key={template.id} className="hover:shadow-e2 hover:-translate-y-0.5 transition-all">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl ${TEMPLATE_STYLE[template.id].tone} flex items-center justify-center text-white shadow-e1 flex-shrink-0`}>
                  <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-ink text-sm">{template.name}</h3>
                  <p className="text-xs text-muted mt-0.5">{template.description}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" size="sm" className="flex-1">
                  View Report
                </Button>
                <Button variant="outline" size="sm">
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
          )
        })}
      </div>

      <ReportBuilder tenantId={tenant.id} />
    </div>
  )
}
