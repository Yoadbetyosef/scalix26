import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, Download } from 'lucide-react'
import { ReportBuilder } from '@/components/reports/report-builder'

const REPORT_TEMPLATES = [
  { id: 'platform_usage', name: 'Platform Usage', description: 'Total conversations, messages, and active channels over time.' },
  { id: 'ai_productivity', name: 'AI Employee Productivity', description: 'Resolution rates, handle times, and skill usage per AI employee.' },
  { id: 'lead_generation', name: 'Lead Generation', description: 'Leads captured, qualified, and converted per channel.' },
  { id: 'appointment_report', name: 'Appointment Report', description: 'Booked, completed, and no-show appointments.' },
]

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).single()
  if (!tenant) redirect('/auth/signup')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Build and export custom reports</p>
      </div>

      {/* Templates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {REPORT_TEMPLATES.map(template => (
          <Card key={template.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#4ecdc4]/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-[#4ecdc4]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 text-sm">{template.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
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
        ))}
      </div>

      <ReportBuilder tenantId={tenant.id} />
    </div>
  )
}
