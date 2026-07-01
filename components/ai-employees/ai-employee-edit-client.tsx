'use client'

import { useState, useEffect, type ElementType } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ArrowLeft, Phone, Trash2, Link2Off, Share2, MessageCircle, Mail, Building2, BookOpen, Clock, Bot, Mic, Wand2, Briefcase } from 'lucide-react'
import { FacebookIcon, InstagramIcon } from '@/components/icons/brand-icons'
import Link from 'next/link'
import { VoiceDemo } from '@/components/ai-employees/voice-demo'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import { employeeStatus } from '@/lib/employee'
import { KnowledgeBaseEditor, type KBEntry } from '@/components/ai-employees/knowledge-base-editor'
import { BusinessDetails } from '@/components/ai-employees/business-details'
import { SkillsEditor } from '@/components/ai-employees/skills-editor'
import { PaymentCollection } from '@/components/ai-employees/payment-collection'
import { AvailabilityClient } from '@/components/settings/availability-client'
import { CalendarConnect } from '@/components/ai-employees/calendar-connect'
import { StripeConnect } from '@/components/ai-employees/stripe-connect'
import { slotsToHours, businessHoursToDayHours, dayHoursToBusinessHours, type DayHours } from '@/lib/appointments'
import { Sparkles } from 'lucide-react'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABELS: Record<typeof DAYS[number], string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

// Shared dropdown+toggle grid used by BOTH the informational Business Hours section
// (stored in ai_employees.business_hours) and the Appointment Availability section
// (stored in appointment_slots). 30-min options, 12h labels.
const TIME_SLOTS: { value: string; label: string }[] = (() => {
  const out: { value: string; label: string }[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const value = `${h}:${String(m).padStart(2, '0')}`        // e.g. "9:00", "17:30"
      const period = h < 12 ? 'AM' : 'PM'
      const h12 = h % 12 === 0 ? 12 : h % 12
      out.push({ value, label: `${h12}:${String(m).padStart(2, '0')} ${period}` })
    }
  }
  return out
})()

// Apple-style colored section tile — gives every section its own living identity on a
// calm white canvas. Color is the element, not decoration.
function SectionIcon({ icon: Icon, tone }: { icon: ElementType; tone: string }) {
  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] ${tone} text-white shadow-e1`}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
    </span>
  )
}

function TimeSelect({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-10 rounded-xl border border-hairline-strong bg-white px-2.5 text-sm text-ink outline-none transition-shadow duration-200 focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.04)]"
    >
      {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  )
}

function WeeklyHoursGrid({ hours, onUpdate }: {
  hours: Record<string, DayHours>
  onUpdate: (day: string, next: Partial<DayHours>) => void
}) {
  return (
    <div className="mt-3 rounded-xl border border-hairline divide-y divide-hairline">
      {DAYS.map(day => {
        const { isOpen, open, close } = hours[day]
        return (
          <div key={day} className="flex items-center gap-3 px-3 sm:px-4 py-3">
            <div className="flex items-center gap-2.5 w-28 sm:w-36 shrink-0">
              <Switch checked={isOpen} onCheckedChange={v => onUpdate(day, { isOpen: v })} aria-label={`${DAY_LABELS[day]} open`} />
              <span className="text-sm font-medium text-ink">{DAY_LABELS[day]}</span>
            </div>
            {isOpen ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <TimeSelect value={open} onChange={v => onUpdate(day, { open: v })} ariaLabel={`${DAY_LABELS[day]} opening time`} />
                <span className="text-xs text-muted">to</span>
                <TimeSelect value={close} onChange={v => onUpdate(day, { close: v })} ariaLabel={`${DAY_LABELS[day]} closing time`} />
              </div>
            ) : (
              <span className="flex-1 text-sm text-muted italic">Closed</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface Channel {
  id: string
  type: string
  status: string
  twilio_number: string | null
  meta_page_id: string | null
  credentials: Record<string, string>
  sms_status?: string | null
  messaging_service_sid?: string | null
}

interface Props {
  employee: {
    id: string
    name: string
    greeting: string
    voice: string
    voice_language: string | null
    system_prompt: string | null
    status: string
    // Business identity
    business_name: string | null
    industry: string | null
    website: string | null
    phone: string | null
    email: string | null
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
    business_hours: Record<string, string> | null
    timezone: string | null
    forward_to_phone: string | null
    email_auto_reply: boolean | null
    email_handoff_after_first_reply: boolean | null
    reply_from_email: string | null
    website_scanned_at?: string | null
    website_scanned_url?: string | null
    website_kb_item_count?: number | null
    channels?: Channel[]
  }
  tenantId: string
  tenantSlug: string
  businessDetails: Record<string, string>
  knowledgeBase: KBEntry[]
  metaConnected?: boolean
  metaError?: string
  emailAccounts?: { id: string; provider: string; email_address: string; status: string; is_primary: boolean }[]
  googleConnected?: boolean
  googleError?: string
  onboarding?: boolean
  skills?: { type: string; active: boolean }[]
  availabilitySlots?: { day_of_week: number; slot_time: string }[]
  googleReviewUrl?: string
  reviewEnabled?: boolean
}

const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'Email connection was cancelled.',
  invalid_state: 'Security check failed. Please try again.',
  token_failed: 'Could not connect your inbox. Please try again.',
  mailbox_limit: 'You can connect up to 3 mailboxes per agent. Disconnect one first.',
}

const META_ERRORS: Record<string, string> = {
  cancelled: 'Facebook connection was cancelled.',
  invalid_state: 'Security check failed. Please try again.',
  token_failed: 'Could not get Facebook access. Please try again.',
  pages_failed: 'Could not load your Facebook pages. Please try again.',
  no_pages: 'No Facebook pages found on your account. Create a page first.',
  session_expired: 'Session expired. Please try connecting again.',
  page_in_use: 'This Facebook or Instagram page is already connected to another account.',
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const sec = Math.round((Date.now() - then) / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  if (sec < 60) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  const mon = Math.round(day / 30)
  return `${mon} month${mon === 1 ? '' : 's'} ago`
}

export function AIEmployeeEditClient({ employee, tenantId, tenantSlug, businessDetails, knowledgeBase, metaConnected, metaError, emailAccounts = [], googleConnected, googleError, onboarding, skills, availabilitySlots, googleReviewUrl, reviewEnabled }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: employee.name || '',
    greeting: employee.greeting || '',
    voice: employee.voice || 'professional_female',
    voice_language: employee.voice_language || 'en',
    system_prompt: employee.system_prompt || '',
    status: employee.status || 'draft',
    email_auto_reply: employee.email_auto_reply ?? true,
    email_handoff_after_first_reply: employee.email_handoff_after_first_reply ?? false,
    reply_from_email: employee.reply_from_email || '',
    // Business identity
    business_name: employee.business_name || '',
    industry: employee.industry || '',
    website: employee.website || '',
    phone: employee.phone || '',
    email: employee.email || '',
    city: employee.city || '',
    state: employee.state || '',
    zip: employee.zip || '',
    forward_to_phone: employee.forward_to_phone || '',
  })

  // SECTION 1 — Business Hours (informational): the open-hours fact the AI tells
  // callers. Stored in ai_employees.business_hours (JSON). Does NOT drive booking.
  const [businessHours, setBusinessHours] = useState<Record<string, DayHours>>(() => businessHoursToDayHours(employee.business_hours))
  function updateBusinessHours(day: string, next: Partial<DayHours>) {
    setBusinessHours(w => ({ ...w, [day]: { ...w[day], ...next } }))
  }

  // SECTION 2 — Appointment Availability (drives booking): the windows the owner
  // accepts appointments. Stored in appointment_slots (the ONLY thing the booking
  // tools read), reconstructed here as ranges; saving expands them to hourly slots.
  const [appointmentHours, setAppointmentHours] = useState<Record<string, DayHours>>(() => slotsToHours(availabilitySlots || []))

  // Unsaved-changes tracking for the sticky save bar. Baseline = the snapshot at
  // last successful save (initialized to the loaded values). Only covers what
  // handleSave persists (form + both hours); KB/Skills/Channels save instantly on
  // their own and aren't part of this.
  const editedSnapshot = JSON.stringify({ form, businessHours, appointmentHours })
  const [savedSnapshot, setSavedSnapshot] = useState(editedSnapshot)
  const isDirty = editedSnapshot !== savedSnapshot

  // Show toast on OAuth return
  useEffect(() => {
    if (metaConnected) toast.success('Facebook connected!')
    if (metaError) toast.error(META_ERRORS[metaError] || 'Connection failed.')
    if (googleConnected) toast.success('Inbox connected!')
    if (googleError) toast.error(GOOGLE_ERRORS[googleError] || 'Connection failed.')
  }, [metaConnected, metaError, googleConnected, googleError])

  const [emailBusy, setEmailBusy] = useState(false)
  async function disconnectMailbox(accountId: string) {
    if (!confirm('Disconnect this mailbox? The AI will stop reading and replying from it.')) return
    setEmailBusy(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect_email', accountId }),
      })
      if (!res.ok) throw new Error()
      toast.success('Mailbox disconnected')
      router.refresh()
    } catch {
      toast.error('Failed to disconnect')
    } finally {
      setEmailBusy(false)
    }
  }
  async function setPrimaryMailbox(accountId: string) {
    setEmailBusy(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_primary_email', accountId }),
      })
      if (!res.ok) throw new Error()
      toast.success('Primary mailbox updated')
      router.refresh()
    } catch {
      toast.error('Failed to update primary')
    } finally {
      setEmailBusy(false)
    }
  }

  // Scan the website and populate this agent's knowledge base. Explicit-trigger only
  // (no auto-rescrape on save), graceful, and never blocks the rest of the form.
  const [scanningWebsite, setScanningWebsite] = useState(false)
  async function scanWebsite() {
    const url = form.website.trim()
    if (!url) { toast.error('Enter a website URL first'); return }
    setScanningWebsite(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}/scan-website`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const json = await res.json().catch(() => ({}))
      if (json.added > 0) {
        toast.success(`Added ${json.added} item${json.added === 1 ? '' : 's'} from your website${json.titles?.length ? ': ' + json.titles.join(', ') : ''}`)
        router.refresh() // reload the KB list with the new website entries
      } else {
        toast(json.error || json.message || 'No new details found on your website.')
      }
    } catch {
      toast.error('Could not scan the website. You can add details manually below.')
    } finally {
      setScanningWebsite(false)
    }
  }

  // Channel state
  const [channels, setChannels] = useState<Channel[]>(employee.channels || [])
  const [provisioningPhone, setProvisioningPhone] = useState(false)
  const [releasingPhone, setReleasingPhone] = useState(false)

  const phoneChannel = channels.find(c => (c.type === 'sms' || c.type === 'voice') && c.twilio_number && c.status === 'connected')
  const smsChannel = channels.find(c => c.type === 'sms' && c.twilio_number)
  const fbChannel = channels.find(c => c.type === 'facebook' && c.status === 'connected')
  const igChannel = channels.find(c => c.type === 'instagram' && c.status === 'connected')

  // Website scan state: "Connected" only when a scan exists AND the field still matches
  // the exact URL that was scanned; if the owner edited the URL since, it's stale.
  const scannedUrl = (employee.website_scanned_url || '').trim()
  const websiteVal = form.website.trim()
  const websiteConnected = !!employee.website_scanned_at && scannedUrl !== '' && scannedUrl === websiteVal
  const websiteChanged = scannedUrl !== '' && scannedUrl !== websiteVal
  const kbCount = employee.website_kb_item_count ?? 0

  function updateAppointmentHours(day: string, next: Partial<DayHours>) {
    setAppointmentHours(w => ({ ...w, [day]: { ...w[day], ...next } }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, business_hours: dayHoursToBusinessHours(businessHours), weekly_hours: appointmentHours }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSavedSnapshot(editedSnapshot) // baseline = what we just saved → bar hides
      toast.success('Agent saved!')
      // Deferred provisioning: buy the first number AFTER the address/ZIP is saved so it
      // matches the customer's area. Idempotent — no-op if a number already exists.
      if (!phoneChannel) await provisionPhone()
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const [finishing, setFinishing] = useState(false)
  // Onboarding: persist the details, clear the draft flag (so New Employee no longer
  // reuses this agent), then go to the dashboard.
  async function finishSetup() {
    setFinishing(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, business_hours: dayHoursToBusinessHours(businessHours), weekly_hours: appointmentHours }),
      })
      if (!res.ok) throw new Error('Save failed')
      // Guarantee a number before leaving onboarding (region-aware from the saved ZIP;
      // falls back to any-local if none). Idempotent — won't buy a second.
      if (!phoneChannel) await provisionPhone()
      await fetch(`/api/agents/${employee.id}/finish`, { method: 'POST' }).catch(() => {})
      toast.success('You’re all set!')
      router.push('/dashboard')
    } catch {
      toast.error('Could not finish setup — please try again')
      setFinishing(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${employee.name}? This cannot be undone.`)) return
    // Server-side delete: releases the agent's Twilio number(s) BEFORE the DB
    // cascade wipes the channel rows (and their SIDs).
    try {
      const res = await fetch(`/api/agents/${employee.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Deleted')
      router.push('/ai-employees')
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function toggleStatus() {
    const newStatus = form.status === 'active' ? 'draft' : 'active'
    setForm(f => ({ ...f, status: newStatus }))
    await supabase.from('ai_employees').update({ status: newStatus }).eq('id', employee.id)
    toast.success(newStatus === 'active' ? 'Agent is now live!' : 'Agent paused')
  }

  async function provisionPhone() {
    setProvisioningPhone(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'provision_phone' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`Phone number provisioned: ${data.phoneNumber}`)
      // Flip the Phone card to Connected immediately: `channels` useState was seeded from
      // props on mount and won't pick up router.refresh(). Mirror the two rows provision
      // creates (sms + voice). The provision_phone action is idempotent, so this only
      // reflects the result — it never double-provisions.
      const num: string = data.phoneNumber
      setChannels(prev => {
        const others = prev.filter(c => c.type !== 'sms' && c.type !== 'voice')
        const mk = (type: string): Channel => ({ id: `new-${type}`, type, status: 'connected', twilio_number: num, meta_page_id: null, credentials: {} })
        return [...others, mk('sms'), mk('voice')]
      })
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to provision phone')
    } finally {
      setProvisioningPhone(false)
    }
  }

  async function releasePhone() {
    if (!confirm('Release this phone number? Customers will no longer be able to call or text it.')) return
    setReleasingPhone(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release_phone' }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Phone number released')
      setChannels(prev => prev.filter(c => c.type !== 'sms' && c.type !== 'voice'))
      router.refresh()
    } catch {
      toast.error('Failed to release phone number')
    } finally {
      setReleasingPhone(false)
    }
  }

  async function disconnectChannel(type: string) {
    if (!confirm(`Disconnect ${type}?`)) return
    const res = await fetch(`/api/agents/${employee.id}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect', type }),
    })
    if (res.ok) {
      toast.success(`${type} disconnected`)
      setChannels(prev => prev.map(c => c.type === type ? { ...c, status: 'disconnected' } : c))
      router.refresh()
    } else {
      toast.error('Failed to disconnect')
    }
  }

  return (
    <div className={`space-y-5 p-4 sm:p-6 ${isDirty && !onboarding ? 'pb-24' : ''}`}>
      {/* Onboarding welcome banner */}
      {onboarding && (
        <div className="rounded-2xl border border-[#5B6CF0]/30 bg-[#5B6CF0]/10 p-4 sm:p-5">
          <h2 className="text-base font-light tracking-tight text-ink">Your AI employee is live — your number is already answering.</h2>
          <p className="text-sm text-subtle mt-1">Finish the quick setup — business details, voice, channels, and website — to start protecting your business from missed calls, messages, and lost customers.</p>
          <Button onClick={finishSetup} loading={finishing} className="mt-3">Finish setup →</Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex items-center gap-3">
          {onboarding ? (
            <>
              <EmployeeAvatar name={form.name || employee.name} voice={form.voice} status={employeeStatus(form.status)} size="md" />
              <h1 className="text-xl sm:text-2xl font-light tracking-tight text-ink">{employee.name}</h1>
            </>
          ) : (
            <>
              <Link href="/ai-employees">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
              </Link>
              <EmployeeAvatar name={form.name || employee.name} voice={form.voice} status={employeeStatus(form.status)} size="md" />
              <div>
                <h1 className="text-xl sm:text-2xl font-light tracking-tight text-ink">{employee.name}</h1>
                <Badge variant={form.status as 'active' | 'draft'} className="mt-0.5">{form.status}</Badge>
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2 sm:flex-shrink-0">
          {!onboarding && (
            <Button variant="outline" onClick={toggleStatus} className="flex-1 sm:flex-none">
              {form.status === 'active' ? 'Pause' : 'Go Live'}
            </Button>
          )}
          <Button onClick={handleSave} loading={saving} variant={onboarding ? 'outline' : undefined} className="flex-1 sm:flex-none">Save Changes</Button>
          {onboarding && (
            <Button onClick={finishSetup} loading={finishing} className="flex-1 sm:flex-none">Finish setup</Button>
          )}
        </div>
      </div>

      {/* Business Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Building2} tone="bg-blue-500" /> Business Identity</CardTitle>
          <p className="text-sm text-subtle">This agent represents a separate business identity with its own contact info.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Business Name</Label>
              <Input className="mt-1.5" placeholder="Smith's Locksmith" value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} />
            </div>
            <div>
              <Label>Industry / Business Type</Label>
              <Input className="mt-1.5" placeholder="Locksmith" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} />
            </div>
            <div>
              <Label>Business Phone</Label>
              <Input className="mt-1.5" type="tel" placeholder="(555) 123-4567" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>Business Email</Label>
              <Input className="mt-1.5" type="email" placeholder="info@yourbusiness.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label>City</Label>
              <Input className="mt-1.5" placeholder="New York" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div>
              <Label>State</Label>
              <Input className="mt-1.5" placeholder="NY" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
            </div>
            <div>
              <Label>ZIP</Label>
              <Input className="mt-1.5" placeholder="10001" inputMode="numeric" maxLength={5} value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value.replace(/\D/g, '').slice(0, 5) }))} />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2">
                <Label>Website</Label>
                {websiteConnected && <Badge variant="connected">Connected</Badge>}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <Input type="url" placeholder="https://yourbusiness.com" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
                <Button type="button" variant="outline" size="sm" disabled={scanningWebsite || !websiteVal} onClick={scanWebsite}>
                  {scanningWebsite ? 'Scanning…' : websiteConnected ? 'Re-scan' : 'Scan website'}
                </Button>
              </div>
              {scanningWebsite ? (
                <p className="text-xs text-accent-strong mt-1.5 inline-flex items-center gap-2">
                  <span className="flex items-end gap-[2px] h-3" aria-hidden="true">
                    {[0, 1, 2].map((i) => <span key={i} className="sx-wavebar w-[2px] h-full rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />)}
                  </span>
                  Scanning your business…
                </p>
              ) : websiteConnected ? (
                <p className="text-xs text-subtle mt-1">Last scanned {relativeTime(employee.website_scanned_at!)} · {kbCount} item{kbCount === 1 ? '' : 's'} added.</p>
              ) : websiteChanged ? (
                <p className="text-xs text-amber-600 mt-1">Website changed — scan to update the agent&apos;s knowledge.</p>
              ) : (
                <p className="text-xs text-muted mt-1">Optional. We&apos;ll read your site and add services, pricing, service areas, and hours to the agent&apos;s knowledge below. Nothing is invented — anything not on your site, you can fill in manually.</p>
              )}
            </div>
          </div>

          {/* SECTION 1 — Business Hours (informational; answers "what are your hours?") */}
          <div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-subtle" />
              <Label className="text-base font-semibold">Business Hours</Label>
            </div>
            <p className="text-xs text-muted mt-1">When a customer asks what hours you&apos;re open, this is what the AI tells them. (This does not control appointment booking.)</p>
            <WeeklyHoursGrid hours={businessHours} onUpdate={updateBusinessHours} />
          </div>
        </CardContent>
      </Card>

      {/* Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Share2} tone="bg-indigo-500" /> Channels</CardTitle>
          <p className="text-sm text-subtle">Connect any combination of channels. Each channel is optional — the agent handles whatever is connected.</p>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Phone (calls + SMS) */}
          <div className="p-5 rounded-2xl border border-hairline space-y-3">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-subtle" />
              <span className="font-semibold text-ink">Phone (calls + SMS)</span>
              {phoneChannel && <Badge variant="connected">Connected</Badge>}
            </div>

            {phoneChannel ? (
              <div className="space-y-3">
                {/* How it works — matches the real ring-through behavior */}
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-sm font-semibold text-blue-900 mb-1.5">How it works</p>
                  <ol className="text-sm text-blue-700 space-y-1">
                    <li>1. A customer calls your AI line</li>
                    <li>2. Your phone rings first (4 rings)</li>
                    <li>3. If you&apos;re busy, your AI answers — no lead lost</li>
                  </ol>
                </div>

                {/* Your AI line */}
                <div className="bg-sunken rounded-xl p-3">
                  <p className="text-xs text-subtle mb-0.5">Your AI line</p>
                  <p className="text-lg font-light tracking-tight text-ink tracking-wider">{phoneChannel.twilio_number}</p>
                  <p className="text-xs text-muted mt-1.5">This is the line your AI receptionist answers on. Use it as your business number, or forward your existing number to it — either way, your own phone always rings first.</p>
                </div>

                {/* A4: texting (SMS / A2P) status — calls are instant; texting needs carrier verification. */}
                {smsChannel && (() => {
                  const s = smsChannel.sms_status || 'pending_verification'
                  if (s === 'active') {
                    return <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl p-3"><span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> Texting: active</div>
                  }
                  if (s === 'failed') {
                    return <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-1.5" /> Texting needs attention — carrier verification didn&apos;t complete. We&apos;ll reach out to finish it.</div>
                  }
                  return <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3"><span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1.5" /> 📞 Calls are live now. 💬 Texting is being verified and will activate soon.</div>
                })()}

                {/* Your phone number (rings first) */}
                <div>
                  <Label className="text-sm">Your phone number</Label>
                  <p className="text-xs text-muted mb-1.5">Enter your cell or office number. When a customer calls, your phone rings first — if you don&apos;t answer within 4 rings, your AI receptionist picks up so you never miss a lead.</p>
                  <Input
                    className="h-11 text-sm"
                    type="tel"
                    placeholder="(555) 987-6543"
                    value={form.forward_to_phone}
                    onChange={e => setForm(f => ({ ...f, forward_to_phone: e.target.value }))}
                  />
                  {form.forward_to_phone.trim() ? (
                    <p className="text-xs text-green-600 mt-1.5">✓ Connected — your phone rings first, your AI catches anything you miss.</p>
                  ) : (
                    <p className="text-xs text-subtle mt-1.5">No number yet — your AI answers every call directly.</p>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={releasePhone}
                  loading={releasingPhone}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  <Link2Off className="w-3.5 h-3.5 mr-1.5" />
                  Release Number
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-subtle">No phone number assigned. Provision a dedicated number for this agent — handles both inbound calls and SMS.</p>
                <Button onClick={provisionPhone} loading={provisioningPhone} size="sm">
                  <Phone className="w-3.5 h-3.5 mr-1.5" />
                  {provisioningPhone ? 'Provisioning...' : 'Get Phone Number'}
                </Button>
              </div>
            )}
          </div>

          {/* Facebook + Instagram — one OAuth flow connects both */}
          <div className="p-5 rounded-2xl border border-hairline space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1">
                <FacebookIcon className="w-4 h-4" />
                <InstagramIcon className="w-4 h-4" />
              </span>
              <span className="font-semibold text-ink">Facebook & Instagram</span>
              {fbChannel && <Badge variant="connected">FB Connected</Badge>}
              {igChannel && <Badge variant="connected">IG Connected</Badge>}
              {!fbChannel && !igChannel && <Badge variant="disconnected">Not connected</Badge>}
            </div>

            {(fbChannel || igChannel) ? (
              <div className="space-y-3">
                {/* Facebook row */}
                <div className="bg-sunken rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-subtle mb-0.5 flex items-center gap-1">
                      <FacebookIcon className="w-3 h-3" /> Facebook Page
                    </p>
                    <p className="text-sm font-medium text-ink truncate">
                      {fbChannel
                        ? ((fbChannel.credentials as Record<string, string>)?.page_name || fbChannel.meta_page_id)
                        : <span className="text-muted italic">Not connected</span>}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <a href={`/api/auth/meta/connect?agentId=${employee.id}`}>
                      <Button size="sm" variant="outline">
                        {fbChannel ? 'Switch Page' : 'Connect'}
                      </Button>
                    </a>
                    {fbChannel && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnectChannel('facebook')}
                        className="text-red-600 border-red-200 hover:bg-red-50 px-2"
                      >
                        <Link2Off className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Instagram row */}
                <div className="bg-sunken rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-subtle mb-0.5 flex items-center gap-1">
                      <InstagramIcon className="w-3 h-3" /> Instagram Account
                    </p>
                    {igChannel ? (
                      <p className="text-sm font-medium text-ink truncate">
                        {(igChannel.credentials as Record<string, string>)?.username
                          ? `@${(igChannel.credentials as Record<string, string>).username}`
                          : igChannel.meta_page_id}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">
                        Not connected — link Instagram to your Facebook page first, then reconnect.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {!igChannel && (
                      <a href={`/api/auth/meta/connect?agentId=${employee.id}`}>
                        <Button size="sm" variant="outline">Connect</Button>
                      </a>
                    )}
                    {igChannel && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnectChannel('instagram')}
                        className="text-red-600 border-red-200 hover:bg-red-50 px-2"
                      >
                        <Link2Off className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-subtle">
                  Connect your Facebook Page and Instagram Business Account with one click.
                  If your page has Instagram linked, both channels connect automatically.
                </p>
                <a href={`/api/auth/meta/connect?agentId=${employee.id}`}>
                  {/* Meta Facebook Login brand guidelines: official blue #1877F2, white "f". */}
                  <Button size="sm" className="bg-[#1877F2] hover:bg-[#166fe0] text-white">
                    <FacebookIcon className="w-3.5 h-3.5 mr-1.5" color="#FFFFFF" />
                    Continue with Facebook
                  </Button>
                </a>
                <p className="text-xs text-muted">
                  You&apos;ll be redirected to Facebook to choose which page to connect.
                </p>
              </div>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Email — channel order: Phone → Facebook/Instagram → Email */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Mail} tone="bg-violet-500" /> Email</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-subtle">Connect your inbox and the AI reads new customer emails and replies natively from your address.</p>

          {/* Option B — Connect your own inbox (Gmail OAuth). Recommended. */}
          <div className="rounded-2xl border border-hairline p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink flex items-center gap-2">
                <Mail className="w-4 h-4" /> Connect your inbox
                <span className="text-[11px] font-medium text-[#4338CA] bg-[#eef1fd] rounded px-1.5 py-0.5">Recommended</span>
              </span>
              <span className="text-xs text-muted">{emailAccounts.length}/3 mailboxes</span>
            </div>

            {/* Connected mailboxes (up to 3 — all feed the same shared inbox). */}
            {emailAccounts.length > 0 && (
              <div className="mt-3 space-y-2">
                {emailAccounts.map((acct) => (
                  <div key={acct.id} className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-sunken px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-ink font-mono truncate">{acct.email_address}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {acct.status === 'connected'
                          ? <Badge variant="connected">Connected</Badge>
                          : <Badge variant="disconnected">Reconnect needed</Badge>}
                        {acct.is_primary && <span className="text-[11px] font-medium text-subtle bg-white border border-hairline rounded px-1.5 py-0.5">Primary</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {acct.status === 'error' && (
                        <a href={`/api/auth/${acct.provider === 'microsoft' ? 'microsoft' : 'google'}/connect?agentId=${employee.id}`}>
                          <Button type="button" size="sm" variant="outline">Reconnect</Button>
                        </a>
                      )}
                      {!acct.is_primary && acct.status === 'connected' && emailAccounts.length > 1 && (
                        <Button type="button" size="sm" variant="outline" disabled={emailBusy} onClick={() => setPrimaryMailbox(acct.id)}>Set primary</Button>
                      )}
                      <Button type="button" size="sm" variant="outline" disabled={emailBusy} onClick={() => disconnectMailbox(acct.id)} aria-label="Disconnect mailbox">
                        <Link2Off className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {emailAccounts.length < 3 ? (
              <div className="mt-3">
                <p className="text-sm text-subtle mb-2">{emailAccounts.length === 0 ? 'Connect Gmail/Google Workspace or Outlook/Microsoft 365 — the AI replies from your own address, with full threading.' : 'Add another mailbox (up to 3). Both feed the same shared inbox.'}</p>
                <div className="flex items-center gap-2">
                  <a href={`/api/auth/google/connect?agentId=${employee.id}`}>
                    <Button type="button" size="sm" variant={emailAccounts.length ? 'outline' : undefined}>{emailAccounts.length ? 'Add Gmail' : 'Connect Gmail'}</Button>
                  </a>
                  <a href={`/api/auth/microsoft/connect?agentId=${employee.id}`}>
                    <Button type="button" size="sm" variant="outline">{emailAccounts.length ? 'Add Outlook' : 'Connect Outlook'}</Button>
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted mt-3">You&apos;ve reached the limit of 3 mailboxes. Disconnect one to add another.</p>
            )}
          </div>

          {/* Option A — Forward to our Resend inbound address. HIDDEN from the UI for now
              (backend inbound webhook + reply path stay fully active; we'll re-expose
              this per-brand later). Render-gated only — do not delete. */}
          {false && (
          <div className="rounded-2xl border border-hairline p-5">
            <span className="font-semibold text-ink flex items-center gap-2"><Share2 className="w-4 h-4" /> Or forward your email</span>
            <p className="text-sm text-subtle mt-1">No inbox connection — just forward your business email to the address below and the AI handles replies.</p>
            <div className="flex items-center gap-2 mt-3">
              <Input readOnly value={`${tenantSlug}@mail.mylocksmithai.com`} className="bg-sunken font-mono text-sm" />
              <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(`${tenantSlug}@mail.mylocksmithai.com`); toast.success('Copied') }}>Copy</Button>
            </div>
            <div className="mt-3">
              <Label>Reply-from email (optional)</Label>
              <Input className="mt-1.5" type="email" placeholder="info@yourbusiness.com" value={form.reply_from_email} onChange={e => setForm(f => ({ ...f, reply_from_email: e.target.value }))} />
              <p className="text-xs text-muted mt-1">Emails appear to come from this address (its domain must be verified in Resend). Blank = sent from our address.</p>
            </div>
          </div>
          )}

          {/* One mutually-exclusive choice mapped to the two existing booleans:
              manual → email_auto_reply=false
              first  → email_auto_reply=true,  email_handoff_after_first_reply=true
              whole  → email_auto_reply=true,  email_handoff_after_first_reply=false
              Derived from the current field values on load (null treated as false). */}
          {(() => {
            const autoReply = form.email_auto_reply === true
            const handoff = form.email_handoff_after_first_reply === true
            const selected: 'manual' | 'first' | 'whole' = !autoReply ? 'manual' : handoff ? 'first' : 'whole'
            const setMode = (mode: 'manual' | 'first' | 'whole') => setForm(f => ({
              ...f,
              email_auto_reply: mode !== 'manual',
              email_handoff_after_first_reply: mode === 'first',
            }))
            const options: { value: 'manual' | 'first' | 'whole'; title: string; help: string; recommended?: boolean }[] = [
              { value: 'manual', title: "Don't reply automatically — emails go to my inbox", help: 'The AI reads emails into your Inbox but never replies automatically. You handle every reply yourself.' },
              { value: 'first', title: 'Reply to the first email, then hand the thread to me', help: "The AI sends one reply to acknowledge, then hands the conversation to you — it won't send anything else in that thread.", recommended: true },
              { value: 'whole', title: 'Reply to the whole email conversation', help: 'The AI handles the entire email thread automatically, back and forth.' },
            ]
            return (
              <div className="space-y-2">
                {options.map(opt => (
                  <label
                    key={opt.value}
                    htmlFor={`email_mode_${opt.value}`}
                    className={`flex gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${selected === opt.value ? 'border-accent/40 bg-accent/5 shadow-e1' : 'border-hairline hover:border-hairline-strong hover:bg-sunken/50'}`}
                  >
                    <input
                      id={`email_mode_${opt.value}`}
                      type="radio"
                      name="email_mode"
                      checked={selected === opt.value}
                      onChange={() => setMode(opt.value)}
                      className="accent-[#5B6CF0] w-4 h-4 mt-0.5 flex-shrink-0"
                    />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-ink">{opt.title}</span>
                        {opt.recommended && <span className="text-[10px] font-semibold uppercase tracking-wide text-[#4338CA] bg-[#5B6CF0]/15 px-1.5 py-0.5 rounded">Recommended</span>}
                      </div>
                      <p className="text-xs text-muted mt-0.5">{opt.help}</p>
                    </div>
                  </label>
                ))}
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Basic Info */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Bot} tone="bg-pink-500" /> AI Persona</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Agent Name</Label>
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


      {/* Voice */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Mic} tone="bg-cyan-500" /> Voice</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <VoiceDemo value={form.voice} onChange={(v) => setForm(f => ({ ...f, voice: v }))} />
          <div>
            <Label>Call language</Label>
            <select
              value={form.voice_language}
              onChange={e => setForm(f => ({ ...f, voice_language: e.target.value }))}
              className="mt-1.5 w-full rounded-xl border border-hairline-strong bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-shadow duration-200 focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.04)]"
            >
              <option value="en">English</option>
              <option value="es">Spanish (Español)</option>
              <option value="bilingual">Bilingual (English + Spanish)</option>
            </select>
            <p className="text-xs text-muted mt-1">
              Language the agent understands and speaks on phone calls. Bilingual auto-detects and switches between English and Spanish. (Text channels already reply in the caller&apos;s language.)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Custom Instructions */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Wand2} tone="bg-amber-500" /> Custom Instructions</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={5}
            value={form.system_prompt}
            onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
            placeholder="Add specific instructions for this AI agent. E.g.: Always mention our 24/7 emergency line. Never quote prices over $500 without manager approval."
          />
        </CardContent>
      </Card>

      {/* Business Details */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Briefcase} tone="bg-emerald-500" /> Business Details</CardTitle></CardHeader>
        <CardContent>
          <BusinessDetails tenantId={tenantId} agentId={employee.id} initial={businessDetails} />
        </CardContent>
      </Card>

      {/* Skills */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Sparkles} tone="bg-fuchsia-500" /> Skills</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-subtle mb-3">What your AI can do on calls and messages. Toggles save instantly.</p>
          <SkillsEditor agentId={employee.id} initial={skills || []} />
          <PaymentCollection agentId={employee.id} />
        </CardContent>
      </Card>

      {/* SECTION 2 — Appointment Availability (drives booking; backed by appointment_slots) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5"><SectionIcon icon={Clock} tone="bg-sky-500" /> Appointment Availability</CardTitle>
          <p className="text-sm text-subtle">When you&apos;ll take appointments. The AI only books inside these windows — separate from your open hours.</p>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setAppointmentHours({ ...businessHours })}>
              Copy from Business Hours
            </Button>
          </div>
          <WeeklyHoursGrid hours={appointmentHours} onUpdate={updateAppointmentHours} />
          <CalendarConnect agentId={employee.id} />
          <StripeConnect agentId={employee.id} />
        </CardContent>
      </Card>

      {/* Google review automation. */}
      <AvailabilityClient
        tenantId={tenantId}
        embedded
        googleReviewUrl={googleReviewUrl || ''}
        reviewEnabled={reviewEnabled ?? true}
      />

      {/* Knowledge Base */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2.5"><SectionIcon icon={BookOpen} tone="bg-orange-500" /> Knowledge Base</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-subtle mb-3">Extra facts the AI uses to answer customers. Saved instantly.</p>
          <KnowledgeBaseEditor tenantId={tenantId} agentId={employee.id} initialEntries={knowledgeBase} />
        </CardContent>
      </Card>

      {/* Bottom Save — in its own card so it clearly reads as "save the whole agent"
          (a bare floating button looked like it saved just the section above). The
          green primary action lives HERE, not in the red Danger Zone. In onboarding
          it's "Finish setup"; when editing it's "Save Changes". */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
          <p className="text-sm text-subtle">
            {onboarding ? 'Finish setting up this AI employee.' : 'Save all changes to this AI employee.'}
          </p>
          {onboarding ? (
            <Button onClick={finishSetup} loading={finishing} className="w-full sm:w-auto">Finish setup</Button>
          ) : (
            <Button onClick={handleSave} loading={saving} className="w-full sm:w-auto">Save Changes</Button>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone — destructive actions only. The green primary action moved up
          to the Save card above so it never sits beside the red Delete. */}
      <Card className="border-danger/20">
        <CardHeader><CardTitle className="text-danger">Danger Zone</CardTitle></CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Agent
          </Button>
        </CardContent>
      </Card>

      {/* Sticky save bar — appears only when there are unsaved changes. Same
          handleSave/payload/loading state as the header + bottom buttons. */}
      {isDirty && !onboarding && (
        <div className="fixed bottom-4 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-hairline bg-white shadow-e3 px-5 py-2.5">
            <span className="inline-flex items-center gap-2 text-sm text-subtle">
              <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
              Unsaved changes
            </span>
            <Button onClick={handleSave} loading={saving} size="sm">Save Changes</Button>
          </div>
        </div>
      )}
    </div>
  )
}
