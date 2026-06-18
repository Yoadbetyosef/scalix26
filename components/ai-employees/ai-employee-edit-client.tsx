'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Phone, Trash2, Link2Off, Share2, MessageCircle, Mail, Building2, BookOpen } from 'lucide-react'
import Link from 'next/link'
import { VoiceDemo } from '@/components/ai-employees/voice-demo'
import { KnowledgeBaseEditor, type KBEntry } from '@/components/ai-employees/knowledge-base-editor'
import { BusinessDetails } from '@/components/ai-employees/business-details'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABELS: Record<typeof DAYS[number], string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

interface Channel {
  id: string
  type: string
  status: string
  twilio_number: string | null
  meta_page_id: string | null
  credentials: Record<string, string>
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
  emailAccount?: { id: string; provider: string; email_address: string; status: string } | null
  googleConnected?: boolean
  googleError?: string
}

const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'Email connection was cancelled.',
  invalid_state: 'Security check failed. Please try again.',
  token_failed: 'Could not connect your inbox. Please try again.',
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

export function AIEmployeeEditClient({ employee, tenantId, tenantSlug, businessDetails, knowledgeBase, metaConnected, metaError, emailAccount, googleConnected, googleError }: Props) {
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
    forward_to_phone: employee.forward_to_phone || '',
    business_hours: employee.business_hours || {
      mon: '9:00-17:00', tue: '9:00-17:00', wed: '9:00-17:00',
      thu: '9:00-17:00', fri: '9:00-17:00', sat: 'closed', sun: 'closed',
    },
  })

  // Show toast on OAuth return
  useEffect(() => {
    if (metaConnected) toast.success('Facebook connected!')
    if (metaError) toast.error(META_ERRORS[metaError] || 'Connection failed.')
    if (googleConnected) toast.success('Inbox connected!')
    if (googleError) toast.error(GOOGLE_ERRORS[googleError] || 'Connection failed.')
  }, [metaConnected, metaError, googleConnected, googleError])

  const [disconnectingEmail, setDisconnectingEmail] = useState(false)
  async function disconnectEmailInbox() {
    if (!confirm('Disconnect this inbox? The AI will stop reading and replying from it.')) return
    setDisconnectingEmail(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect_email' }),
      })
      if (!res.ok) throw new Error()
      toast.success('Inbox disconnected')
      router.refresh()
    } catch {
      toast.error('Failed to disconnect')
    } finally {
      setDisconnectingEmail(false)
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
  const fbChannel = channels.find(c => c.type === 'facebook' && c.status === 'connected')
  const igChannel = channels.find(c => c.type === 'instagram' && c.status === 'connected')

  // Website scan state: "Connected" only when a scan exists AND the field still matches
  // the exact URL that was scanned; if the owner edited the URL since, it's stale.
  const scannedUrl = (employee.website_scanned_url || '').trim()
  const websiteVal = form.website.trim()
  const websiteConnected = !!employee.website_scanned_at && scannedUrl !== '' && scannedUrl === websiteVal
  const websiteChanged = scannedUrl !== '' && scannedUrl !== websiteVal
  const kbCount = employee.website_kb_item_count ?? 0

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/agents/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Save failed')
      toast.success('Agent saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
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
    <div className="space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/ai-employees">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{employee.name}</h1>
            <Badge variant={form.status as 'active' | 'draft'} className="mt-0.5">{form.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2 sm:flex-shrink-0">
          <Button variant="outline" onClick={toggleStatus} className="flex-1 sm:flex-none">
            {form.status === 'active' ? 'Pause' : 'Go Live'}
          </Button>
          <Button onClick={handleSave} loading={saving} className="flex-1 sm:flex-none">Save Changes</Button>
        </div>
      </div>

      {/* Business Identity */}
      <Card>
        <CardHeader>
          <CardTitle>Business Identity</CardTitle>
          <p className="text-sm text-gray-500">This agent represents a separate business identity with its own contact info.</p>
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
              {websiteConnected ? (
                <p className="text-xs text-gray-500 mt-1">Last scanned {relativeTime(employee.website_scanned_at!)} · {kbCount} item{kbCount === 1 ? '' : 's'} added.</p>
              ) : websiteChanged ? (
                <p className="text-xs text-amber-600 mt-1">Website changed — scan to update the agent&apos;s knowledge.</p>
              ) : (
                <p className="text-xs text-gray-400 mt-1">Optional. We&apos;ll read your site and add services, pricing, service areas, and hours to the agent&apos;s knowledge below. Nothing is invented — anything not on your site, you can fill in manually.</p>
              )}
            </div>
          </div>

          {/* Business Hours */}
          <div>
            <Label className="text-base font-semibold">Business Hours</Label>
            <div className="mt-2 space-y-2">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-gray-600 font-medium">{DAY_LABELS[day]}</span>
                  <Input
                    className="h-11 text-sm flex-1"
                    placeholder="9:00-17:00 or closed"
                    value={(form.business_hours as Record<string, string>)[day] || ''}
                    onChange={e => setForm(f => ({
                      ...f,
                      business_hours: { ...(f.business_hours as Record<string, string>), [day]: e.target.value },
                    }))}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">Format: 9:00-17:00 or "closed"</p>
          </div>
        </CardContent>
      </Card>

      {/* Channels */}
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <p className="text-sm text-gray-500">Connect any combination of channels. Each channel is optional — the agent handles whatever is connected.</p>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Phone (calls + SMS) */}
          <div className="p-4 rounded-xl border border-gray-200 space-y-3">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-gray-600" />
              <span className="font-semibold text-gray-800">Phone (calls + SMS)</span>
              {phoneChannel && <Badge variant="connected">Connected</Badge>}
            </div>

            {phoneChannel ? (
              <div className="space-y-3">
                {/* How it works — matches the real ring-through behavior */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <p className="text-sm font-semibold text-blue-900 mb-1.5">How it works</p>
                  <ol className="text-sm text-blue-700 space-y-1">
                    <li>1. A customer calls your AI line</li>
                    <li>2. Your phone rings first (4 rings)</li>
                    <li>3. If you&apos;re busy, your AI answers — no lead lost</li>
                  </ol>
                </div>

                {/* Your AI line */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-0.5">Your AI line</p>
                  <p className="text-lg font-bold text-gray-900 tracking-wider">{phoneChannel.twilio_number}</p>
                  <p className="text-xs text-gray-400 mt-1.5">This is the line your AI receptionist answers on. Use it as your business number, or forward your existing number to it — either way, your own phone always rings first.</p>
                </div>

                {/* Your phone number (rings first) */}
                <div>
                  <Label className="text-sm">Your phone number</Label>
                  <p className="text-xs text-gray-400 mb-1.5">Enter your cell or office number. When a customer calls, your phone rings first — if you don&apos;t answer within 4 rings, your AI receptionist picks up so you never miss a lead.</p>
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
                    <p className="text-xs text-gray-500 mt-1.5">No number yet — your AI answers every call directly.</p>
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
                <p className="text-sm text-gray-500">No phone number assigned. Provision a dedicated number for this agent — handles both inbound calls and SMS.</p>
                <Button onClick={provisionPhone} loading={provisioningPhone} size="sm">
                  <Phone className="w-3.5 h-3.5 mr-1.5" />
                  {provisioningPhone ? 'Provisioning...' : 'Get Phone Number'}
                </Button>
              </div>
            )}
          </div>

          {/* Facebook + Instagram — one OAuth flow connects both */}
          <div className="p-4 rounded-xl border border-gray-200 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Share2 className="w-4 h-4 text-blue-600" />
              <span className="font-semibold text-gray-800">Facebook & Instagram</span>
              {fbChannel && <Badge variant="connected">FB Connected</Badge>}
              {igChannel && <Badge variant="connected">IG Connected</Badge>}
              {!fbChannel && !igChannel && <Badge variant="disconnected">Not connected</Badge>}
            </div>

            {(fbChannel || igChannel) ? (
              <div className="space-y-3">
                {/* Facebook row */}
                <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                      <Share2 className="w-3 h-3" /> Facebook Page
                    </p>
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {fbChannel
                        ? ((fbChannel.credentials as Record<string, string>)?.page_name || fbChannel.meta_page_id)
                        : <span className="text-gray-400 italic">Not connected</span>}
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
                <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" /> Instagram Account
                    </p>
                    {igChannel ? (
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {(igChannel.credentials as Record<string, string>)?.username
                          ? `@${(igChannel.credentials as Record<string, string>).username}`
                          : igChannel.meta_page_id}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">
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
                <p className="text-sm text-gray-500">
                  Connect your Facebook Page and Instagram Business Account with one click.
                  If your page has Instagram linked, both channels connect automatically.
                </p>
                <a href={`/api/auth/meta/connect?agentId=${employee.id}`}>
                  <Button size="sm">
                    <Share2 className="w-3.5 h-3.5 mr-1.5" />
                    Connect with Facebook
                  </Button>
                </a>
                <p className="text-xs text-gray-400">
                  You&apos;ll be redirected to Facebook to choose which page to connect.
                </p>
              </div>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Basic Info */}
      <Card>
        <CardHeader><CardTitle>AI Persona</CardTitle></CardHeader>
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
        <CardHeader><CardTitle>Voice</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <VoiceDemo value={form.voice} onChange={(v) => setForm(f => ({ ...f, voice: v }))} systemPrompt={form.system_prompt} />
          <div>
            <Label>Call language</Label>
            <select
              value={form.voice_language}
              onChange={e => setForm(f => ({ ...f, voice_language: e.target.value }))}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="en">English</option>
              <option value="es">Spanish (Español)</option>
              <option value="bilingual">Bilingual (English + Spanish)</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Language the agent understands and speaks on phone calls. Bilingual auto-detects and switches between English and Spanish. (Text channels already reply in the caller&apos;s language.)
            </p>
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
            placeholder="Add specific instructions for this AI agent. E.g.: Always mention our 24/7 emergency line. Never quote prices over $500 without manager approval."
          />
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="w-4 h-4 text-[#4ecdc4]" /> Email</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-gray-500">Connect your inbox and the AI reads new customer emails and replies natively from your address.</p>

          {/* Option B — Connect your own inbox (Gmail OAuth). Recommended. */}
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-800 flex items-center gap-2">
                <Mail className="w-4 h-4" /> Connect your inbox
                <span className="text-[11px] font-medium text-[#1a9d92] bg-[#e7f8f6] rounded px-1.5 py-0.5">Recommended</span>
              </span>
              {emailAccount && emailAccount.status === 'connected' && <Badge variant="connected">Connected</Badge>}
              {emailAccount && emailAccount.status === 'error' && <Badge variant="disconnected">Reconnect needed</Badge>}
              {!emailAccount && <Badge variant="disconnected">Not connected</Badge>}
            </div>

            {emailAccount ? (
              <div className="mt-3 space-y-3">
                {emailAccount.status === 'error' && (
                  <p className="text-sm text-red-600">Access to <span className="font-mono">{emailAccount.email_address}</span> expired or was revoked. Reconnect so the AI can keep reading and replying.</p>
                )}
                {emailAccount.status === 'connected' && (
                  <p className="text-sm text-gray-600">Connected as <span className="font-mono">{emailAccount.email_address}</span>. The AI reads new customer emails and replies natively from this address.</p>
                )}
                <div className="flex items-center gap-2">
                  {emailAccount.status === 'error' && (
                    <a href={`/api/auth/google/connect?agentId=${employee.id}`}>
                      <Button type="button" size="sm">Reconnect Gmail</Button>
                    </a>
                  )}
                  <Button type="button" variant="outline" size="sm" disabled={disconnectingEmail} onClick={disconnectEmailInbox}>
                    <Link2Off className="w-3 h-3 mr-1" /> Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-sm text-gray-500 mb-3">Connect Gmail or Google Workspace. The AI replies directly from your own address, with full email threading.</p>
                <a href={`/api/auth/google/connect?agentId=${employee.id}`}>
                  <Button type="button" size="sm">Connect Gmail</Button>
                </a>
                <p className="text-xs text-gray-400 mt-2">You&apos;ll be redirected to Google to grant access. Microsoft 365 support is coming soon.</p>
              </div>
            )}
          </div>

          {/* Option A — Forward to our Resend inbound address. HIDDEN from the UI for now
              (backend inbound webhook + reply path stay fully active; we'll re-expose
              this per-brand later). Render-gated only — do not delete. */}
          {false && (
          <div className="rounded-lg border border-gray-200 p-4">
            <span className="font-semibold text-gray-800 flex items-center gap-2"><Share2 className="w-4 h-4" /> Or forward your email</span>
            <p className="text-sm text-gray-500 mt-1">No inbox connection — just forward your business email to the address below and the AI handles replies.</p>
            <div className="flex items-center gap-2 mt-3">
              <Input readOnly value={`${tenantSlug}@mail.mylocksmithai.com`} className="bg-gray-50 font-mono text-sm" />
              <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(`${tenantSlug}@mail.mylocksmithai.com`); toast.success('Copied') }}>Copy</Button>
            </div>
            <div className="mt-3">
              <Label>Reply-from email (optional)</Label>
              <Input className="mt-1.5" type="email" placeholder="info@yourbusiness.com" value={form.reply_from_email} onChange={e => setForm(f => ({ ...f, reply_from_email: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">Emails appear to come from this address (its domain must be verified in Resend). Blank = sent from our address.</p>
            </div>
          </div>
          )}

          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.email_auto_reply} onChange={e => setForm(f => ({ ...f, email_auto_reply: e.target.checked }))} className="accent-[#4ecdc4] w-4 h-4" />
              Auto-reply to incoming emails
            </label>
            <p className="text-xs text-gray-400 mt-1">Applies to both options. When off, emails appear in the Inbox but the AI won&apos;t reply automatically.</p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.email_handoff_after_first_reply} onChange={e => setForm(f => ({ ...f, email_handoff_after_first_reply: e.target.checked }))} className="accent-[#4ecdc4] w-4 h-4" disabled={!form.email_auto_reply} />
              After the first auto-reply, hand the conversation to me (AI stops replying).
            </label>
            <p className="text-xs text-gray-400 mt-1">The AI sends one reply to acknowledge, then you take it from there — it won&apos;t send anything else in that email thread.</p>
          </div>
        </CardContent>
      </Card>

      {/* Business Details */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="w-4 h-4 text-[#4ecdc4]" /> Business Details</CardTitle></CardHeader>
        <CardContent>
          <BusinessDetails tenantId={tenantId} agentId={employee.id} initial={businessDetails} />
        </CardContent>
      </Card>

      {/* Knowledge Base */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-[#4ecdc4]" /> Knowledge Base</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-3">Extra facts the AI uses to answer customers. Saved instantly.</p>
          <KnowledgeBaseEditor tenantId={tenantId} agentId={employee.id} initialEntries={knowledgeBase} />
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader><CardTitle className="text-red-600">Danger Zone</CardTitle></CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Agent
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
