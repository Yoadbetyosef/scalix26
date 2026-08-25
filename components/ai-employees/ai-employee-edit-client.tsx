'use client'
import { WeeklyHoursGrid } from './hours-controls'
import { useAgentEditor, type Channel } from './use-agent-editor'

import { ChevronLeft, Phone, Trash2, Link2Off, Mail, Building2, BookOpen, Clock, Bot, Mic, Wand2, Briefcase, CalendarCheck, Globe, Zap } from 'lucide-react'
import { FacebookIcon, InstagramIcon } from '@/components/icons/brand-icons'
import Link from 'next/link'
import { GlassInput, GlassSelect, GlassChoice, StatusPill } from '@/app/(v2)/v2/controls'
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
import { QuickbooksConnect } from '@/components/ai-employees/quickbooks-connect'
import { Sparkles } from 'lucide-react'
import type { ElementType, ReactNode } from 'react'

// A SECTION. This screen has fourteen of them, and v1 gave each one a white card with a filled
// icon tile in its own colour — fourteen surfaces and fourteen brand colours on one page, which is
// why it read as a settings dump rather than one employee.
//
// .v2-group is /v2's own section, already designed for exactly this screen (see
// app/(v2)/v2/agents/[id]/client.tsx, which prototyped it): a micro-label with a dot in the
// section's hue, a rule to the edge, and one bordered card holding the rows. The hue cycles through
// the four accent samples rather than reaching for a fifth colour per section.
function Group({ hue, title, children, danger }: { hue?: string; title: string; children: ReactNode; danger?: boolean }) {
  return (
    <section className="v2-group" data-danger={danger || undefined} style={hue ? { ['--ghue' as string]: hue } : undefined}>
      <p className="v2-ghead" data-danger={danger || undefined}><i />{title}<s /></p>
      <div className="v2-gcard">{children}</div>
    </section>
  )
}

// A row inside a section: the chip, what it says, and whatever sits on the end.
function Row({ icon: Icon, children, trail, danger }: { icon: ElementType; children: ReactNode; trail?: ReactNode; danger?: boolean }) {
  return (
    <div className="v2-grow" data-static>
      <span className="v2-gchip" data-danger={danger || undefined}><Icon /></span>
      <span className="v2-glab">{children}</span>
      {trail && <span className="v2-gtrail">{trail}</span>}
    </div>
  )
}

export interface Props {
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
  // Moved to use-agent-editor.ts so a second surface can drive the SAME machine. Every state var and
  // every handler went with it — see that file's header. Only what this render actually reads is
  // destructured; the previous list pulled every export and left seventeen unused bindings behind.
  const {
    saving, form, setForm, businessHours, updateBusinessHours, appointmentHours, setAppointmentHours, isDirty, emailBusy, disconnectMailbox, setPrimaryMailbox, scanningWebsite, scanWebsite, provisioningPhone, releasingPhone, phoneChannel, smsChannel, fbChannel, igChannel, websiteVal, websiteConnected, websiteChanged, kbCount, updateAppointmentHours, handleSave, finishing, finishSetup, handleDelete, toggleStatus, provisionPhone, releasePhone, disconnectChannel,
  } = useAgentEditor({ employee, tenantId, tenantSlug, businessDetails, knowledgeBase, metaConnected, metaError, emailAccounts, googleConnected, googleError, onboarding, skills, availabilitySlots, googleReviewUrl, reviewEnabled })
  // Typed against the hook's own form shape, so a field name that does not exist fails to compile
  // rather than silently writing a key nobody reads.
  type FormShape = typeof form
  const set = (k: keyof FormShape) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const live = form.status === 'active'

  return (
    <div className={`v2 v2-embedded agent-edit-root max-md:order-1 w-full max-w-full overflow-x-clip p-4 sm:p-6 ${!onboarding ? 'max-md:pb-40 sm:pb-24' : ''}`}>
      {/* Onboarding welcome banner. One notice, in the language's own notice component, rather than a
          tinted panel in a brand blue that appears nowhere else. */}
      {onboarding && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t3)', alignItems: 'flex-start', marginBottom: 22 }}>
          <span className="v2-chip-sq"><Zap /></span>
          <p>
            Your AI employee is live — your number is already answering.
            <span style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 400, color: 'var(--v2-ink-45)' }}>
              Finish the quick setup — business details, voice, channels and website — to start protecting your business from missed calls, messages and lost customers.
            </span>
            <span className="v2-bar" style={{ marginTop: 12 }}>
              <button onClick={finishSetup} disabled={finishing} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
                {finishing ? 'Finishing…' : 'Finish setup'}
              </button>
            </span>
          </p>
        </div>
      )}

      {/* THE HEADER. The employee's name is the page — the rail says "AI Employees", not which one.
          The face is the robot, the same one the dashboard hero and the inbox rows show. */}
      <div className="v2-head">
        {!onboarding && (
          <Link href="/ai-employees" className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Employees</Link>
        )}
        <s />
        <div className="v2-bar">
          {!onboarding && (
            <button onClick={toggleStatus} className="v2-act tap-target">{live ? 'Pause' : 'Go live'}</button>
          )}
          {onboarding && (
            <button onClick={finishSetup} disabled={finishing} className="v2-act tap-target" data-solid>{finishing ? 'Finishing…' : 'Finish setup'}</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <EmployeeAvatar name={form.name || employee.name} voice={form.voice} status={employeeStatus(form.status)} size="md" />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--v2-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{employee.name}</h1>
          <p className="v2-kick" style={{ marginTop: 6, marginBottom: 0, ['--ghue' as string]: live ? 'var(--v2-live)' : 'var(--v2-mute)' }}>
            <i />{live ? 'On duty · answering right now' : 'Paused · nothing is being answered'}
          </p>
        </div>
      </div>

      {/* The one line that says what the whole screen is for, and whether anything is outstanding. */}
      <p className="v2-lin" style={{ marginBottom: 26 }}>
        <span>This is how {form.name || 'this employee'} introduces itself and what it knows about you. </span>
        {isDirty ? <b>You have unsaved changes.</b> : <span>Everything here is saved.</span>}
      </p>

      <div className="sx-stagger">
        <Group hue="var(--v2-t1)" title="Business identity">
          <Row icon={Building2}>This agent represents a separate business identity, with its own contact details.</Row>
          <GlassInput label="Business name" value={form.business_name} onChange={set('business_name')} placeholder="Smith’s Locksmith" />
          <GlassInput label="Industry / business type" value={form.industry} onChange={set('industry')} placeholder="Locksmith" />
          <GlassInput label="Business phone" value={form.phone} onChange={set('phone')} type="tel" placeholder="(555) 123-4567" />
          <GlassInput label="Business email" value={form.email} onChange={set('email')} type="email" placeholder="info@yourbusiness.com" />
          <GlassInput label="City" value={form.city} onChange={set('city')} placeholder="New York" />
          <GlassInput label="State" value={form.state} onChange={set('state')} placeholder="NY" />
          <GlassInput label="ZIP" value={form.zip} onChange={(v) => setForm((f) => ({ ...f, zip: v.replace(/\D/g, '').slice(0, 5) }))} placeholder="10001" />
        </Group>

        <Group hue="var(--v2-t2)" title="Website">
          <Row icon={Globe} trail={<StatusPill state={websiteConnected ? 'live' : 'off'}>{websiteConnected ? 'Scanned' : 'Not scanned'}</StatusPill>}>
            {scanningWebsite
              ? 'Reading your site…'
              : websiteConnected
                ? `Last scanned ${relativeTime(employee.website_scanned_at!)} · ${kbCount} item${kbCount === 1 ? '' : 's'} added.`
                : websiteChanged
                  ? 'Website changed — scan again to update what the agent knows.'
                  : 'Optional. We read your site and add services, pricing, service areas and hours below. Nothing is invented — anything not on your site, you fill in yourself.'}
          </Row>
          <GlassInput label="Website" value={form.website} onChange={set('website')} type="url" placeholder="https://yourbusiness.com" />
          <div className="v2-bar" style={{ padding: '0 14px 14px' }}>
            <button type="button" disabled={scanningWebsite || !websiteVal} onClick={scanWebsite} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
              {scanningWebsite ? 'Scanning…' : websiteConnected ? 'Re-scan' : 'Scan website'}
            </button>
          </div>
        </Group>

        {/* SECTION 1 — Business Hours (informational; answers "what are your hours?") */}
        <Group hue="var(--v2-t3)" title="Business hours">
          <Row icon={Clock}>When a customer asks what hours you are open, this is what the AI tells them. It does not control appointment booking.</Row>
          <div className="v2-hours"><WeeklyHoursGrid hours={businessHours} onUpdate={updateBusinessHours} /></div>
        </Group>

        {/* Channels — phone */}
        <Group hue="var(--v2-t4)" title="Phone">
          <Row icon={Phone} trail={<StatusPill state={phoneChannel ? 'live' : 'off'}>{phoneChannel ? 'Connected' : 'Not connected'}</StatusPill>}>
            {phoneChannel
              ? <>Answering on <b style={{ fontWeight: 600, letterSpacing: '0.02em' }}>{phoneChannel.twilio_number}</b>. Use it as your business number, or forward your existing one to it — either way your own phone rings first.</>
              : 'No number yet. Provision a dedicated line for this agent — it handles inbound calls and SMS.'}
          </Row>

          {phoneChannel ? (
            <>
              {/* How it works — matches the real ring-through behaviour. Three numbered facts, as a
                  fact list rather than a tinted blue box with an ordered list inside it. */}
              <div style={{ padding: '0 14px 4px' }}>
                <dl className="v2-facts" data-narrow>
                  <div><dt>1</dt><dd>A customer calls your AI line</dd></div>
                  <div><dt>2</dt><dd>Your phone rings first, four rings</dd></div>
                  <div><dt>3</dt><dd>If you are busy, your AI answers — no lead lost</dd></div>
                </dl>
              </div>

              {/* A4: texting (SMS / A2P) status — calls are instant; texting needs carrier verification. */}
              {smsChannel && (() => {
                const st = smsChannel.sms_status || 'pending_verification'
                const state = st === 'active' ? 'live' : st === 'failed' ? 'off' : 'pending'
                return (
                  <Row icon={Phone} trail={<StatusPill state={state}>{st === 'active' ? 'Active' : st === 'failed' ? 'Needs attention' : 'Verifying'}</StatusPill>}>
                    {st === 'active'
                      ? 'Texting is active.'
                      : st === 'failed'
                        ? 'Carrier verification for texting did not complete. We will reach out to finish it.'
                        : 'Calls are live now. Texting is being verified and will activate soon.'}
                  </Row>
                )
              })()}

              <GlassInput
                label="Your phone number"
                value={form.forward_to_phone}
                onChange={set('forward_to_phone')}
                type="tel"
                placeholder="(555) 987-6543"
                hint={form.forward_to_phone.trim()
                  ? 'Your phone rings first; your AI catches anything you miss.'
                  : 'Your cell or office number. Leave it blank and your AI answers every call directly.'}
              />
              <div className="v2-bar" style={{ padding: '0 14px 14px' }}>
                <button type="button" onClick={releasePhone} disabled={releasingPhone} className="v2-act tap-target" data-danger>
                  <Link2Off className="w-3.5 h-3.5" /> Release number
                </button>
              </div>
            </>
          ) : (
            <div className="v2-bar" style={{ padding: '0 14px 14px' }}>
              <button type="button" onClick={provisionPhone} disabled={provisioningPhone} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
                <Phone className="w-3.5 h-3.5" /> {provisioningPhone ? 'Provisioning…' : 'Get a phone number'}
              </button>
            </div>
          )}
        </Group>

        {/* Facebook + Instagram — one OAuth flow connects both */}
        <Group hue="var(--v2-t1)" title="Facebook & Instagram">
          <Row
            icon={FacebookIcon}
            trail={fbChannel
              ? <span className="flex items-center gap-1.5"><StatusPill state="live">Connected</StatusPill><a href={`/api/auth/meta/connect?agentId=${employee.id}`} className="v2-act tap-target">Switch page</a><button onClick={() => disconnectChannel('facebook')} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} aria-label="Disconnect Facebook"><Link2Off /></button></span>
              : <a href={`/api/auth/meta/connect?agentId=${employee.id}`} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>Connect</a>}
          >
            {fbChannel
              ? ((fbChannel.credentials as Record<string, string>)?.page_name || fbChannel.meta_page_id)
              : 'No Facebook Page connected. One sign-in connects the Page and, if it is linked, Instagram with it.'}
          </Row>
          <Row
            icon={InstagramIcon}
            trail={igChannel
              ? <span className="flex items-center gap-1.5"><StatusPill state="live">Connected</StatusPill><button onClick={() => disconnectChannel('instagram')} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} aria-label="Disconnect Instagram"><Link2Off /></button></span>
              : <a href={`/api/auth/meta/connect?agentId=${employee.id}`} className="v2-act tap-target">Connect</a>}
          >
            {igChannel
              ? ((igChannel.credentials as Record<string, string>)?.username ? `@${(igChannel.credentials as Record<string, string>).username}` : igChannel.meta_page_id)
              : 'Not connected — link Instagram to your Facebook Page first, then connect again.'}
          </Row>
        </Group>

        {/* Email — channel order: Phone → Facebook/Instagram → Email */}
        <Group hue="var(--v2-t3)" title="Email">
          <Row icon={Mail} trail={<span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>{emailAccounts.length}/3 mailboxes</span>}>
            Connect your inbox and the AI reads new customer emails and replies natively from your address.
          </Row>

          {/* Connected mailboxes (up to 3 — all feed the same shared inbox). */}
          {emailAccounts.map((acct) => (
            <Row
              key={acct.id}
              icon={Mail}
              trail={
                <span className="flex items-center gap-1.5">
                  {acct.is_primary && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t3)' }}>Primary</span>}
                  <StatusPill state={acct.status === 'connected' ? 'live' : 'off'}>{acct.status === 'connected' ? 'Connected' : 'Reconnect'}</StatusPill>
                  {acct.status === 'error' && (
                    <a href={`/api/auth/${acct.provider === 'microsoft' ? 'microsoft' : 'google'}/connect?agentId=${employee.id}`} className="v2-act tap-target">Reconnect</a>
                  )}
                  {!acct.is_primary && acct.status === 'connected' && emailAccounts.length > 1 && (
                    <button type="button" disabled={emailBusy} onClick={() => setPrimaryMailbox(acct.id)} className="v2-act tap-target">Set primary</button>
                  )}
                  <button type="button" disabled={emailBusy} onClick={() => disconnectMailbox(acct.id)} aria-label="Disconnect mailbox" className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }}><Link2Off /></button>
                </span>
              }
            >
              <span style={{ fontFamily: 'var(--v2-mono)', fontSize: 13 }}>{acct.email_address}</span>
            </Row>
          ))}

          {emailAccounts.length < 3 ? (
            <div className="v2-bar" style={{ padding: '0 14px 14px' }}>
              <a href={`/api/auth/google/connect?agentId=${employee.id}`} className="v2-act tap-target" data-solid={emailAccounts.length ? undefined : true} style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
                {emailAccounts.length ? 'Add Gmail' : 'Connect Gmail'}
              </a>
              <a href={`/api/auth/microsoft/connect?agentId=${employee.id}`} className="v2-act tap-target">
                {emailAccounts.length ? 'Add Outlook' : 'Connect Outlook'}
              </a>
            </div>
          ) : (
            <p className="v2-fhint" style={{ padding: '0 14px 14px' }}>You have reached the limit of 3 mailboxes. Disconnect one to add another.</p>
          )}

          {/* One mutually-exclusive choice mapped to the two existing booleans:
              manual → email_auto_reply=false
              first  → email_auto_reply=true,  email_handoff_after_first_reply=true
              whole  → email_auto_reply=true,  email_handoff_after_first_reply=false
              Derived from the current field values on load (null treated as false).
              Three visible options rather than a select: a reply policy is a decision, and a select
              would hide two thirds of it behind a tap. */}
          <GlassChoice
            label="How it replies"
            value={form.email_auto_reply !== true ? 'manual' : form.email_handoff_after_first_reply === true ? 'first' : 'whole'}
            onChange={(v) => setForm((f) => ({
              ...f,
              email_auto_reply: v !== 'manual',
              email_handoff_after_first_reply: v === 'first',
            }))}
            options={[
              { value: 'first', label: 'First reply only', hint: 'It acknowledges, then hands the thread to you.' },
              { value: 'whole', label: 'The whole conversation', hint: 'It handles the thread back and forth.' },
              { value: 'manual', label: 'Never', hint: 'Email arrives in your Inbox and waits for you.' },
            ]}
          />
        </Group>

        <Group hue="var(--v2-t1)" title="AI persona">
          <Row icon={Bot}>Its name, and the first thing it says on every call and message.</Row>
          <GlassInput label="Agent name" value={form.name} onChange={set('name')} />
          <GlassInput label="Greeting message" value={form.greeting} onChange={set('greeting')} multiline
            placeholder="Hi! Thank you for contacting us. How can I help you today?" />
        </Group>

        <Group hue="var(--v2-t4)" title="Voice">
          <Row icon={Mic}>How it sounds, and the language it answers calls in.</Row>
          <div style={{ padding: '0 14px 4px' }}>
            <VoiceDemo value={form.voice} onChange={(v) => setForm(f => ({ ...f, voice: v }))} />
          </div>
          <GlassSelect
            label="Call language"
            value={form.voice_language}
            onChange={set('voice_language')}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Spanish (Español)' },
              { value: 'bilingual', label: 'Bilingual (English + Spanish)' },
            ]}
            hint="Bilingual auto-detects and switches per caller. Text channels already reply in the caller’s language."
          />
        </Group>

        <Group hue="var(--v2-t2)" title="Custom instructions">
          <Row icon={Wand2}>Rules this agent follows on every call and message.</Row>
          <GlassInput
            label="Instructions"
            value={form.system_prompt}
            onChange={set('system_prompt')}
            multiline
            placeholder="Always mention our 24/7 emergency line. Never quote prices over $500 without manager approval."
          />
        </Group>

        <Group hue="var(--v2-t3)" title="Business details">
          <Row icon={Briefcase}>The facts the AI quotes when a customer asks about how you work.</Row>
          <div style={{ padding: '0 14px 14px' }}>
            <BusinessDetails tenantId={tenantId} agentId={employee.id} initial={businessDetails} />
          </div>
        </Group>

        <Group hue="var(--v2-t1)" title="Skills">
          <Row icon={Sparkles}>What your AI can do on calls and messages. Toggles save instantly.</Row>
          <div style={{ padding: '0 14px 14px' }}>
            <SkillsEditor agentId={employee.id} initial={skills || []} />
            <PaymentCollection agentId={employee.id} />
          </div>
        </Group>

        {/* SECTION 2 — Appointment Availability (drives booking; backed by appointment_slots) */}
        <Group hue="var(--v2-t4)" title="Appointment availability">
          <Row
            icon={CalendarCheck}
            trail={<button type="button" onClick={() => setAppointmentHours({ ...businessHours })} className="v2-act tap-target">Copy from business hours</button>}
          >
            When you will take appointments. The AI only books inside these windows — separate from your open hours.
          </Row>
          <div className="v2-hours"><WeeklyHoursGrid hours={appointmentHours} onUpdate={updateAppointmentHours} /></div>
          <div style={{ padding: '0 14px 14px' }}>
            <CalendarConnect agentId={employee.id} />
            <StripeConnect agentId={employee.id} />
            <QuickbooksConnect agentId={employee.id} />
          </div>
        </Group>

        {/* Google review automation. */}
        <AvailabilityClient
          tenantId={tenantId}
          embedded
          googleReviewUrl={googleReviewUrl || ''}
          reviewEnabled={reviewEnabled ?? true}
        />

        <Group hue="var(--v2-t2)" title="Knowledge base">
          <Row icon={BookOpen}>Extra facts the AI uses to answer customers. Saved instantly.</Row>
          <div style={{ padding: '0 14px 14px' }}>
            <KnowledgeBaseEditor tenantId={tenantId} agentId={employee.id} initialEntries={knowledgeBase} />
          </div>
        </Group>

        {/* SAVE. The filled pill only when there is something to save — otherwise the one strong
            control on the screen points at a no-op. v1 put this in a card of its own to make it read
            as "save the whole agent"; the bar does that without a fifteenth surface. */}
        <div className="v2-savebar">
          <button
            type="button"
            onClick={onboarding ? finishSetup : handleSave}
            disabled={onboarding ? finishing : (saving || !isDirty)}
            className="v2-act tap-target"
            data-solid={onboarding || isDirty || undefined}
          >
            {onboarding
              ? (finishing ? 'Finishing…' : 'Finish setup')
              : saving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
          </button>
        </div>

        {/* DANGER ZONE — destructive actions only, in the one hue reserved for them. handleDelete
            keeps its own confirmation exactly as it is. */}
        <Group title="Danger zone" danger>
          <Row icon={Trash2} danger trail={<button type="button" onClick={handleDelete} className="v2-danger">Delete agent</button>}>
            Deleting this agent removes its number, its channels and everything it has learned.
          </Row>
        </Group>
      </div>

      {/* THE STICKY SAVE. v1 pinned it at bottom-[calc(4.5rem+safe-area)] — 4.5rem was the height of
          the bottom tab bar, which is gone. --v2-grab-h is the swipe-up handle's own published
          height, so the bar clears whatever the handle actually is rather than a number that used to
          be right. Same handleSave, same payload, same loading state as the button above. */}
      {!onboarding && (
        <div className="v2-sticky-save" data-dirty={isDirty || undefined}>
          {isDirty && (
            <span className="v2-kick" style={{ marginBottom: 0, ['--ghue' as string]: 'var(--v2-amber)' }}>
              <i />Unsaved changes
            </span>
          )}
          <button onClick={handleSave} disabled={saving} className="v2-act tap-target" data-solid>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}
