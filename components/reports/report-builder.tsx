'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  tenantId: string
}

export function ReportBuilder({ tenantId }: Props) {
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState('30')

  async function exportCSV() {
    setLoading(true)
    try {
      // Server export (operator-safe): the API resolves the active workspace + reads with the admin
      // client, so it works both for a business owner and a White Label partner operating a client.
      const res = await fetch(`/api/reports/export?days=${encodeURIComponent(dateRange)}`)
      if (!res.ok) throw new Error('export failed')
      const csv = await res.text()
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ai-report-${dateRange}d.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Report exported!')
    } catch {
      toast.error('Export failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-indigo-500 text-white shadow-e1"><Download className="h-[18px] w-[18px]" strokeWidth={2} /></span>
          Custom Report Builder
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-ink">Date Range</label>
          <select
            className="h-11 rounded-xl border border-hairline-strong bg-white px-3.5 text-sm text-ink outline-none transition-shadow duration-200 focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.04)]"
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
        </div>

        <div className="flex gap-2">
          <Button onClick={exportCSV} loading={loading} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
