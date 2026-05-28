'use client'

import { useState } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tenant } from '@/types'
import { WizardState } from './ai-employee-wizard'
import { toast } from 'sonner'

interface Props {
  tenant: Tenant
  data: WizardState
  updateData: (partial: Partial<WizardState>) => void
}

const INDUSTRIES = [
  'HVAC', 'Plumbing', 'Electrical', 'Cleaning', 'Landscaping',
  'Roofing', 'Pest Control', 'Handyman', 'Pool Service', 'Other',
]

export function Step1BusinessInfo({ tenant, data, updateData }: Props) {
  const [scanning, setScanning] = useState(false)
  const [url, setUrl] = useState(tenant.website || '')
  const [info, setInfo] = useState<Partial<Tenant>>({
    business_name: tenant.business_name,
    industry: tenant.industry || '',
    address: tenant.address || '',
    city: tenant.city || '',
    state: tenant.state || '',
    zip: tenant.zip || '',
    phone: tenant.phone || '',
    email: tenant.email || '',
    website: tenant.website || '',
    ...data.businessInfo,
  })

  async function handleScan() {
    if (!url) return
    setScanning(true)
    try {
      const res = await fetch('/api/ai/scrape-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const scraped = await res.json()
      if (scraped.error) throw new Error(scraped.error)
      setInfo(prev => ({ ...prev, ...scraped }))
      toast.success('Website scanned successfully!')
    } catch {
      toast.error('Could not scan website. Fill in manually.')
    } finally {
      setScanning(false)
    }
  }

  function handleChange(field: keyof Tenant, value: string) {
    const updated = { ...info, [field]: value }
    setInfo(updated)
    updateData({ businessInfo: updated })
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Business Information</h2>
        <p className="text-sm text-gray-500">Paste your website URL to auto-fill, or fill in manually.</p>
      </div>

      {/* Website scan */}
      <div>
        <Label>Website URL</Label>
        <div className="flex gap-2 mt-1.5">
          <Input
            placeholder="https://yourcompany.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleScan}
            disabled={scanning || !url}
            className="flex-shrink-0"
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4 mr-1" />}
            {scanning ? 'Scanning...' : 'Scan'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Business Name *</Label>
          <Input
            className="mt-1.5"
            value={info.business_name || ''}
            onChange={e => handleChange('business_name', e.target.value)}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label>Industry</Label>
          <select
            className="flex h-10 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-[#4ecdc4]"
            value={info.industry || ''}
            onChange={e => handleChange('industry', e.target.value)}
          >
            <option value="">Select industry</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label>Phone Number</Label>
          <Input
            className="mt-1.5"
            placeholder="+1 (555) 000-0000"
            value={info.phone || ''}
            onChange={e => handleChange('phone', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Label>Street Address</Label>
          <Input
            className="mt-1.5"
            placeholder="123 Main St"
            value={info.address || ''}
            onChange={e => handleChange('address', e.target.value)}
          />
        </div>
        <div>
          <Label>City</Label>
          <Input
            className="mt-1.5"
            value={info.city || ''}
            onChange={e => handleChange('city', e.target.value)}
          />
        </div>
        <div>
          <Label>State</Label>
          <Input
            className="mt-1.5"
            placeholder="TX"
            value={info.state || ''}
            onChange={e => handleChange('state', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
