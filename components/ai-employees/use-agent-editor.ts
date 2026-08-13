'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { businessHoursToDayHours, dayHoursToBusinessHours, slotsToHours, type DayHours } from '@/lib/appointments'
import { toast } from 'sonner'
import type { Props } from './ai-employee-edit-client'

// THE AGENT EDITOR'S STATE MACHINE, AS A HOOK.
//
// Moved here VERBATIM from ai-employee-edit-client.tsx: all eleven state vars, all thirteen handlers,
// and every derived value between them. Nothing stayed behind — a state machine split across two files
// is the fault this exists to prevent, and it is the same lift useTestAi got before /v2 drove it.
//
// THE SIGNATURE IS DELIBERATELY UNCHANGED. It takes the component's own props object and destructures
// the same names inside, so the moved body did not have to be touched. Redesigning that shape while
// moving it would be a second change hiding inside a lift, and this is the one commit that most needs
// to be verifiable. If the shape is wrong, that is a separate task after this lands.
//
// TimeSelect and WeeklyHoursGrid stay where they are for the same reason: commit 0 is a pure lift of
// state and handlers. Commit 2 can pull them up when it needs them.

export interface Channel {
  id: string
  type: string
  status: string
  twilio_number: string | null
  meta_page_id: string | null
  credentials: Record<string, string>
  sms_status?: string | null
  messaging_service_sid?: string | null
}

export const META_ERRORS: Record<string, string> = {
  cancelled: 'Facebook connection was cancelled.',
  invalid_state: 'Security check failed. Please try again.',
  token_failed: 'Could not get Facebook access. Please try again.',
  pages_failed: 'Could not load your Facebook pages. Please try again.',
  no_pages: 'No Facebook pages found on your account. Create a page first.',
  session_expired: 'Session expired. Please try connecting again.',
  page_in_use: 'This Facebook or Instagram page is already connected to another account.',
}

export const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'Email connection was cancelled.',
  invalid_state: 'Security check failed. Please try again.',
  token_failed: 'Could not connect your inbox. Please try again.',
  mailbox_limit: 'You can connect up to 3 mailboxes per agent. Disconnect one first.',
}

export function useAgentEditor(props: Props) {
  const { employee, tenantId, tenantSlug, businessDetails, knowledgeBase, metaConnected, metaError, emailAccounts = [], googleConnected, googleError, onboarding, skills, availabilitySlots, googleReviewUrl, reviewEnabled } = props
  const router = useRouter()
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
    // Server API (operator-safe) scopes the write to the validated active business.
    await fetch(`/api/agents/${employee.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) })
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


  return {
    router, saving, setSaving, form, setForm, businessHours, setBusinessHours, updateBusinessHours, appointmentHours, setAppointmentHours, editedSnapshot, savedSnapshot, setSavedSnapshot, isDirty, emailBusy, setEmailBusy, disconnectMailbox, setPrimaryMailbox, scanningWebsite, setScanningWebsite, scanWebsite, channels, setChannels, provisioningPhone, setProvisioningPhone, releasingPhone, setReleasingPhone, phoneChannel, smsChannel, fbChannel, igChannel, scannedUrl, websiteVal, websiteConnected, websiteChanged, kbCount, updateAppointmentHours, handleSave, finishing, setFinishing, finishSetup, handleDelete, toggleStatus, provisionPhone, releasePhone, disconnectChannel,
  }
}
