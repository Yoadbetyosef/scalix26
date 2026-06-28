'use client'

import { useState } from 'react'
import { Plus, Trash2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { WizardState } from './ai-employee-wizard'
import { Tenant } from '@/types'

interface Props {
  tenant: Tenant
  data: WizardState
  updateData: (partial: Partial<WizardState>) => void
}

const FAQ_TEMPLATES: Record<string, Array<{ title: string; content: string; source: string }>> = {
  HVAC: [
    { title: 'Emergency Service', content: 'We offer 24/7 emergency HVAC service. For urgent issues like no heat in winter or no AC in summer, call us immediately.', source: 'template' },
    { title: 'Seasonal Maintenance', content: 'We recommend bi-annual tune-ups: spring for AC and fall for heating. Maintenance plans start at $99/year.', source: 'template' },
    { title: 'Pricing', content: 'Service calls start at $89. Repairs range from $150-$800 depending on parts. New system installations typically $3,000-$10,000.', source: 'template' },
  ],
  Plumbing: [
    { title: 'Emergency Plumbing', content: '24/7 emergency service for burst pipes, flooding, and sewage backups. We arrive within 60 minutes.', source: 'template' },
    { title: 'Common Services', content: 'Drain cleaning, leak detection, water heater repair/replacement, toilet repair, faucet installation.', source: 'template' },
    { title: 'Pricing', content: 'Service calls from $75. Drain cleaning $150-$300. Water heater replacement $800-$2,000 installed.', source: 'template' },
  ],
  Electrical: [
    { title: 'Services', content: 'Panel upgrades, EV charger installation, outlet repair, lighting installation, code violation repairs.', source: 'template' },
    { title: 'Safety', content: 'All work is done by licensed electricians and inspected to code. We pull permits for all major work.', source: 'template' },
    { title: 'EV Chargers', content: 'Level 2 EV charger installation starts at $500. We work with all major brands.', source: 'template' },
  ],
  Cleaning: [
    { title: 'Services', content: 'Residential and commercial cleaning. Regular maintenance, deep cleaning, move-in/out cleaning.', source: 'template' },
    { title: 'Supplies', content: 'We bring all supplies and equipment. Eco-friendly options available on request.', source: 'template' },
    { title: 'Frequency', content: 'Weekly, bi-weekly, or monthly service. One-time deep cleans also available.', source: 'template' },
  ],
  Landscaping: [
    { title: 'Services', content: 'Lawn mowing, edging, trimming, fertilization, irrigation installation, seasonal cleanup.', source: 'template' },
    { title: 'Pricing', content: 'Weekly mowing from $40/visit based on lot size. Full service packages from $150/month.', source: 'template' },
    { title: 'Seasonal', content: 'Spring cleanup, mulching, fall leaf removal, winterization services available.', source: 'template' },
  ],
}

export function Step3KnowledgeBase({ tenant, data, updateData }: Props) {
  const [items, setItems] = useState(
    data.knowledgeItems.length > 0 ? data.knowledgeItems :
    FAQ_TEMPLATES[tenant.industry || ''] || []
  )
  const [newItem, setNewItem] = useState({ title: '', content: '' })

  function addTemplate() {
    const templates = FAQ_TEMPLATES[tenant.industry || ''] || []
    const updated = [...items, ...templates.filter(t => !items.some(i => i.title === t.title))]
    setItems(updated)
    updateData({ knowledgeItems: updated })
  }

  function addItem() {
    if (!newItem.title || !newItem.content) return
    const updated = [...items, { ...newItem, source: 'manual' }]
    setItems(updated)
    updateData({ knowledgeItems: updated })
    setNewItem({ title: '', content: '' })
  }

  function removeItem(index: number) {
    const updated = items.filter((_, i) => i !== index)
    setItems(updated)
    updateData({ knowledgeItems: updated })
  }

  function updateItem(index: number, field: 'title' | 'content', value: string) {
    const updated = items.map((item, i) => i === index ? { ...item, [field]: value } : item)
    setItems(updated)
    updateData({ knowledgeItems: updated })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink mb-1">Knowledge Base</h2>
          <p className="text-sm text-subtle">Add information your AI employee will use to answer customer questions.</p>
        </div>
        {tenant.industry && FAQ_TEMPLATES[tenant.industry] && (
          <Button variant="outline" size="sm" onClick={addTemplate}>
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            {tenant.industry} Templates
          </Button>
        )}
      </div>

      {/* Existing items */}
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="p-4 rounded-xl border border-hairline bg-sunken space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={item.title}
                onChange={e => updateItem(i, 'title', e.target.value)}
                placeholder="Topic title"
                className="text-sm font-medium"
              />
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="text-red-400 hover:text-red-600 flex-shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <Textarea
              value={item.content}
              onChange={e => updateItem(i, 'content', e.target.value)}
              placeholder="Content..."
              rows={2}
            />
          </div>
        ))}
      </div>

      {/* Add new */}
      <div className="p-4 rounded-xl border-2 border-dashed border-hairline-strong space-y-3">
        <p className="text-sm font-medium text-ink">Add Custom Entry</p>
        <div className="space-y-2">
          <Input
            placeholder="Topic (e.g. 'Payment Methods')"
            value={newItem.title}
            onChange={e => setNewItem(n => ({ ...n, title: e.target.value }))}
          />
          <Textarea
            placeholder="Content..."
            rows={2}
            value={newItem.content}
            onChange={e => setNewItem(n => ({ ...n, content: e.target.value }))}
          />
        </div>
        <Button variant="outline" size="sm" onClick={addItem} disabled={!newItem.title || !newItem.content}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Entry
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-center text-sm text-muted py-4">
          Add knowledge base entries so your AI can answer customer questions accurately.
        </p>
      )}
    </div>
  )
}
