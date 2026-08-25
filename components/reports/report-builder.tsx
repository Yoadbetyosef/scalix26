'use client'

import { useState } from 'react'
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
    <section>
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />Export</p><s />
      </div>
      <p className="v2-hint" style={{ maxWidth: '58ch', marginBottom: 20 }}>
        Every conversation in the window, as a spreadsheet — one row each, with its channel, its
        status and how long it took.
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div className="v2-fld" style={{ width: 190 }}>
          <label htmlFor="rb-range">Date range</label>
          <span className="v2-sel">
            <select id="rb-range" value={dateRange} onChange={e => setDateRange(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </span>
        </div>
        <button onClick={exportCSV} disabled={loading} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t4)', marginBottom: 4 }}>
          <Download className="w-3.5 h-3.5" /> {loading ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
    </section>
  )
}
