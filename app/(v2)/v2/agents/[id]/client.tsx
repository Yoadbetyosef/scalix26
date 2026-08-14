'use client'

import Link from 'next/link'
import { Building2, Sparkles, AudioLines, FileText, Clock, CalendarCheck, Phone, Mail } from 'lucide-react'
import { useAgentEditor } from '@/components/ai-employees/use-agent-editor'
import type { Props } from '@/components/ai-employees/ai-employee-edit-client'
import { WeeklyHoursGrid } from '@/components/ai-employees/hours-controls'
import { GlassInput, GlassSelect, GlassChoice, StatusPill, NeedsConnection } from '../../controls'
import { FacebookGlyph, InstagramGlyph } from '../../brand-glyphs'
import { usePressState } from '../../use-press'

// THE AGENT SCREEN — what makes this agent that agent.
//
// PURE RENDERING. Every value and every setter comes from useAgentEditor, the same machine the real
// editor drives; the shared controls are bound straight to form/setForm. Nothing here holds state,
// fetches, or decides what a change means — which is what keeps "zero logic changes" literally true.
//
// The account's plumbing is NOT here. Which line exists, which mailbox is connected and whether Stripe
// is live all live on /v2/settings/connections, because with two agents those values are shared. What
// belongs here is what differs per agent.
//
// Sections 1 of 4: identity, details, persona, voice. Hours, channel bindings and the rest follow.

const VOICES = [
  { value: 'professional_female', label: 'Professional (female)' },
  { value: 'professional_male', label: 'Professional (male)' },
  { value: 'friendly_female', label: 'Friendly (female)' },
  { value: 'friendly_male', label: 'Friendly (male)' },
]

const LANGUAGES = [
  { value: 'english', label: 'English' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'bilingual', label: 'English & Spanish' },
]

export function AgentClient(props: Props) {
  usePressState()
  const {
    form, setForm, isDirty, businessHours, updateBusinessHours, appointmentHours, updateAppointmentHours,
    phoneChannel, fbChannel, igChannel,
  } = useAgentEditor(props)
  const mailbox = props.emailAccounts?.find((a) => a.is_primary) ?? props.emailAccounts?.[0]
  const { employee } = props
  // Typed against the hook's own form shape, so a field name that does not exist fails to compile
  // rather than silently writing a key nobody reads.
  type FormShape = typeof form
  const set = (k: keyof FormShape) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="v2-page">
      <header className="v2-phd">
        <Link href="/v2/agents" className="v2-bk" aria-label="AI Employees">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </Link>
        <h2>{form.name || 'AI employee'}</h2>
        {/* The header pill: live when this agent is on duty. Green for live state only. */}
        <StatusPill state={employee.status === 'active' ? 'live' : 'off'}>
          {employee.status === 'active' ? 'On duty' : 'Paused'}
        </StatusPill>
      </header>

      <div className="v2-pbody" data-scroll>
        <p className="v2-lin">
          <span>This is how {form.name || 'this employee'} introduces itself and what it knows about you. </span>
          {/* The accent marks the only thing on the screen that needs the person. */}
          {isDirty
            ? <b>You have unsaved changes.</b>
            : <span>Everything here is saved.</span>}
        </p>

        <div className="v2-stagger">
          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
            <p className="v2-ghead"><i />Business identity<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static><span className="v2-gchip"><Building2 /></span>
                <span className="v2-glab">What the caller hears about you</span></div>
              <GlassInput label="Business name" value={form.business_name} onChange={set('business_name')} />
              <GlassInput label="Business phone" value={form.phone} onChange={set('phone')} />
              <GlassInput label="Business email" value={form.email} onChange={set('email')} type="email" />
              <GlassInput label="Website" value={form.website} onChange={set('website')}
                hint="Rudi reads this to learn what you sell." />
            </div>
          </section>

          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
            <p className="v2-ghead"><i />Business details<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static><span className="v2-gchip"><FileText /></span>
                <span className="v2-glab">Where you work, and what kind of work it is</span></div>
              <GlassInput label="Industry" value={form.industry} onChange={set('industry')} />
              <GlassInput label="City" value={form.city} onChange={set('city')} />
              <GlassInput label="State" value={form.state} onChange={set('state')} />
              <GlassInput label="Postcode" value={form.zip} onChange={set('zip')} />
            </div>
          </section>

          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
            <p className="v2-ghead"><i />AI persona<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static><span className="v2-gchip"><Sparkles /></span>
                <span className="v2-glab">Its name, and the first thing it says</span></div>
              <GlassInput label="Agent name" value={form.name} onChange={set('name')} />
              <GlassInput label="Greeting message" value={form.greeting} onChange={set('greeting')} multiline
                hint="The first line of every call and message." />
            </div>
          </section>

          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
            <p className="v2-ghead"><i />Voice<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static><span className="v2-gchip"><AudioLines /></span>
                <span className="v2-glab">How it sounds, and which language it answers in</span></div>
              <GlassSelect label="Voice" value={form.voice} onChange={set('voice')} options={VOICES} />
              <GlassSelect label="Call language" value={form.voice_language || 'english'}
                onChange={set('voice_language')} options={LANGUAGES}
                hint="Bilingual switches per caller, on every turn." />
            </div>
          </section>

          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
            <p className="v2-ghead"><i />Business hours<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static><span className="v2-gchip"><Clock /></span>
                <span className="v2-glab">When you are open. Rudi answers around the clock; this is what it tells people.</span></div>
              <div className="v2-hours">
                <WeeklyHoursGrid hours={businessHours} onUpdate={updateBusinessHours} />
              </div>
            </div>
          </section>

          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
            <p className="v2-ghead"><i />Appointment availability<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static><span className="v2-gchip"><CalendarCheck /></span>
                <span className="v2-glab">The hours Rudi may actually book into — narrower than opening hours, usually.</span></div>
              <div className="v2-hours">
                <WeeklyHoursGrid hours={appointmentHours} onUpdate={updateAppointmentHours} />
              </div>
            </div>
          </section>

          {/* WHAT THIS AGENT ANSWERS ON — the binding, never the connection.
              Buying or releasing a number, connecting a Page and connecting a mailbox all belong to
              /v2/settings/connections: with two agents those are shared. What differs per agent is
              WHICH of them this one uses, and what happens before a call reaches it. */}
          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
            <p className="v2-ghead"><i />Phone<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static>
                <span className="v2-gchip"><Phone /></span>
                <span className="v2-glab">
                  {phoneChannel?.twilio_number
                    ? `Answering on ${phoneChannel.twilio_number}`
                    : 'No line is connected to this agent yet'}
                </span>
                <span className="v2-gtrail">
                  <StatusPill state={phoneChannel ? 'live' : 'off'}>{phoneChannel ? 'Connected' : 'Not connected'}</StatusPill>
                </span>
              </div>
              {!phoneChannel && <NeedsConnection what="A phone line" />}
              <div data-disabled={!phoneChannel || undefined}>
                <GlassInput
                  label="Forward unanswered calls to"
                  value={form.forward_to_phone}
                  onChange={(v) => setForm((f) => ({ ...f, forward_to_phone: v }))}
                  placeholder="+1 555 000 0000"
                  hint="Rings here first. Rudi picks up if nobody does."
                  disabled={!phoneChannel}
                />
              </div>
            </div>
          </section>

          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
            <p className="v2-ghead"><i />Social<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static>
                <span className="v2-gchip"><FacebookGlyph /></span>
                <span className="v2-glab">{fbChannel ? `Page ${fbChannel.meta_page_id}` : 'No Facebook Page is bound to this agent'}</span>
                <span className="v2-gtrail">
                  <StatusPill state={fbChannel ? 'live' : 'off'}>{fbChannel ? 'Connected' : 'Not connected'}</StatusPill>
                </span>
              </div>
              <div className="v2-grow" data-static>
                <span className="v2-gchip"><InstagramGlyph /></span>
                <span className="v2-glab">{igChannel ? `Account ${igChannel.meta_page_id}` : 'No Instagram account is bound to this agent'}</span>
                <span className="v2-gtrail">
                  <StatusPill state={igChannel ? 'live' : 'off'}>{igChannel ? 'Connected' : 'Not connected'}</StatusPill>
                </span>
              </div>
              {!fbChannel && !igChannel && <NeedsConnection what="Facebook or Instagram" />}
            </div>
          </section>

          <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
            <p className="v2-ghead"><i />Email<s /></p>
            <div className="v2-gcard">
              <div className="v2-grow" data-static>
                <span className="v2-gchip"><Mail /></span>
                <span className="v2-glab">{mailbox?.email_address || 'No mailbox is bound to this agent'}</span>
                <span className="v2-gtrail">
                  <StatusPill state={mailbox ? (mailbox.status === 'connected' ? 'live' : 'pending') : 'off'}>
                    {mailbox ? (mailbox.status === 'connected' ? 'Connected' : 'Pending') : 'Not connected'}
                  </StatusPill>
                </span>
              </div>
              {!mailbox && <NeedsConnection what="A mailbox" />}
              <div data-disabled={!mailbox || undefined}>
                {/* Three visible options rather than a select: a reply policy is a decision, and a
                    select would hide two thirds of it behind a tap. */}
                <GlassChoice
                  label="How Rudi replies"
                  value={!form.email_auto_reply ? 'off' : form.email_handoff_after_first_reply ? 'first' : 'always'}
                  onChange={(v) => setForm((f) => ({
                    ...f,
                    email_auto_reply: v !== 'off',
                    email_handoff_after_first_reply: v === 'first',
                  }))}
                  disabled={!mailbox}
                  options={[
                    { value: 'always', label: 'Every email', hint: 'Rudi answers and keeps answering.' },
                    { value: 'first', label: 'First reply only', hint: 'Then it hands the thread to you.' },
                    { value: 'off', label: 'Never', hint: 'Email arrives and waits for you.' },
                  ]}
                />
                <GlassInput
                  label="Reply from"
                  value={form.reply_from_email}
                  onChange={(v) => setForm((f) => ({ ...f, reply_from_email: v }))}
                  placeholder="hello@yourbusiness.com"
                  disabled={!mailbox}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
