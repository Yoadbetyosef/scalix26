'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Trash2 } from 'lucide-react'
import Link from 'next/link'

const VOICES = [
  { id: 'professional_female', label: 'Professional Female', emoji: '👩‍💼' },
  { id: 'professional_male', label: 'Professional Male', emoji: '👨‍💼' },
  { id: 'friendly_female', label: 'Friendly Female', emoji: '👩' },
  { id: 'friendly_male', label: 'Friendly Male', emoji: '👨' },
]

const PERSONALITIES = [
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'empathetic', label: 'Empathetic' },
  { id: 'direct', label: 'Direct' },
]

interface Props {
  employee: any
  tenantId: string
}

export function AIEmployeeEditClient({ employee, tenantId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: employee.name || '',
    greeting: employee.greeting || '',
    personality: employee.personality || 'friendly',
    personality_score: employee.personality_score ?? 70,
    voice: employee.voice || 'professional_female',
    system_prompt: employee.system_prompt || '',
    status: employee.status || 'draft',
  })

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('ai_employees')
        .update(form)
        .eq('id', employee.id)
      if (error) throw error
      toast.success('AI Employee saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${employee.name}? This cannot be undone.`)) return
    const { error } = await supabase.from('ai_employees').delete().eq('id', employee.id)
    if (error) { toast.error('Failed to delete'); return }
    toast.success('Deleted')
    router.push('/ai-employees')
  }

  async function toggleStatus() {
    const newStatus = form.status === 'active' ? 'draft' : 'active'
    setForm(f => ({ ...f, status: newStatus }))
    await supabase.from('ai_employees').update({ status: newStatus }).eq('id', employee.id)
    toast.success(newStatus === 'active' ? 'Employee is now live!' : 'Employee paused')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/ai-employees">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{employee.name}</h1>
            <Badge variant={form.status as 'active' | 'draft'} className="mt-0.5">{form.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={toggleStatus}>
            {form.status === 'active' ? 'Pause' : 'Go Live'}
          </Button>
          <Button onClick={handleSave} loading={saving}>Save Changes</Button>
        </div>
      </div>

      {/* Basic Info */}
      <Card>
        <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input className="mt-1.5" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Greeting Message</Label>
            <Textarea
              className="mt-1.5"
              rows={3}
              value={form.greeting}
              onChange={e => setForm(f => ({ ...f, greeting: e.target.value }))}
              placeholder="Hi! Thank you for contacting us. How can I help you today?"
            />
          </div>
        </CardContent>
      </Card>

      {/* Personality */}
      <Card>
        <CardHeader><CardTitle>Personality</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PERSONALITIES.map(p => (
              <button
                key={p.id}
                onClick={() => setForm(f => ({ ...f, personality: p.id }))}
                className={`p-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                  form.personality === p.id
                    ? 'border-[#4ecdc4] bg-[#4ecdc4]/10 text-[#4ecdc4]'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <Label>Friendliness: {form.personality_score}/100</Label>
            <input
              type="range" min={0} max={100}
              value={form.personality_score}
              onChange={e => setForm(f => ({ ...f, personality_score: Number(e.target.value) }))}
              className="w-full mt-2 accent-[#4ecdc4]"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Very Formal</span><span>Very Friendly</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Voice */}
      <Card>
        <CardHeader><CardTitle>Voice</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {VOICES.map(v => (
              <button
                key={v.id}
                onClick={() => setForm(f => ({ ...f, voice: v.id }))}
                className={`p-3 rounded-lg border-2 text-sm font-medium transition-colors flex items-center gap-2 ${
                  form.voice === v.id
                    ? 'border-[#4ecdc4] bg-[#4ecdc4]/10'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span>{v.emoji}</span>{v.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Custom Instructions */}
      <Card>
        <CardHeader><CardTitle>Custom Instructions</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={5}
            value={form.system_prompt}
            onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
            placeholder="Add specific instructions for this AI employee. E.g.: Always mention our 24/7 emergency line. Never quote prices over $500 without manager approval."
          />
        </CardContent>
      </Card>

      {/* Channels */}
      <Card>
        <CardHeader><CardTitle>Connected Channels</CardTitle></CardHeader>
        <CardContent>
          {employee.channels?.length === 0 ? (
            <p className="text-sm text-gray-500">No channels connected yet.</p>
          ) : (
            <div className="space-y-2">
              {employee.channels?.map((ch: any) => (
                <div key={ch.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium capitalize">{ch.type}</p>
                    {ch.twilio_number && <p className="text-xs text-gray-500">{ch.twilio_number}</p>}
                  </div>
                  <Badge variant={ch.status as 'connected' | 'disconnected' | 'pending'}>{ch.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader><CardTitle className="text-red-600">Danger Zone</CardTitle></CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete AI Employee
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
