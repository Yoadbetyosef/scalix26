import { createAdminClient } from '@/lib/supabase/server'
import { byToken } from '@/lib/miles/decide'
import { triggerLine } from '@/lib/miles/inbox-read'
import { heldSince } from '@/lib/miles/autonomy'
import { nameOf } from '@/lib/persona'
import { DecideForm } from './form'

// THE DECISION PAGE. Reachable only with the token from the owner's own SMS or email.
//
// No session, no navigation, no app chrome: the person here is on a lock screen and has one thing to
// do. Public — listed in PUBLIC_ROUTES — exactly as /approval/[token] is, and guarded the same way:
// the token is the sole credential, only its hash is stored, and it resolves to exactly one draft.

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  // Names nobody and leaks nothing: this URL can end up in a message preview.
  return { title: 'A reply is waiting', robots: { index: false, follow: false } }
}

const shell = (children: React.ReactNode) => (
  <div style={{
    minHeight: '100vh', background: '#f2f2f5', padding: '28px 16px 60px',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: '#0e0e11',
  }}>
    <div style={{ maxWidth: 480, margin: '0 auto' }}>{children}</div>
  </div>
)

function Unavailable() {
  return shell(
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,.07)', padding: 24, textAlign: 'center' }}>
      <h1 style={{ fontSize: 17, margin: '0 0 8px' }}>This link is no longer valid</h1>
      <p style={{ fontSize: 14, color: '#6b6b73', margin: 0, lineHeight: 1.5 }}>
        It may already have been used, or the draft it pointed at is gone. Open the app to see what is
        still waiting.
      </p>
    </div>,
  )
}

export default async function DecidePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = createAdminClient()
  const draft = await byToken(db, token)
  if (!draft) return Unavailable()

  // Who it is to, and who wrote it. Both from the draft's own tenant — nothing here is passed in.
  const [{ data: contact }, { data: agent }] = await Promise.all([
    draft.contact_id
      ? db.from('contacts').select('name, phone, email').eq('id', draft.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    draft.ai_employee_id
      ? db.from('ai_employees').select('name, persona').eq('id', draft.ai_employee_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const who = contact?.name?.trim() || contact?.phone?.trim() || contact?.email?.trim() || 'them'
  const agentName = nameOf(agent as { name?: string | null; persona?: string | null } | null)

  // A decided draft is not an error — the owner probably tapped the link twice, or acted in the app
  // first. Say what happened, and what went out, rather than showing a dead link page.
  if (draft.status !== 'pending') {
    return shell(
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,.07)', padding: 20 }}>
        <h1 style={{ fontSize: 17, margin: '0 0 10px' }}>
          {draft.status === 'sent' ? `Already sent to ${who}.`
            : draft.status === 'handled' ? `You took this thread over.`
            : 'This draft was replaced by a newer one.'}
        </h1>
        {draft.status === 'sent' && (
          <p style={{ fontSize: 14, lineHeight: 1.45, color: '#3d3d45', margin: 0 }}>
            “{draft.sent_body || draft.body}”
          </p>
        )}
        {draft.status === 'handled' && (
          <p style={{ fontSize: 14, color: '#6b6b73', margin: 0 }}>
            Nothing was sent, and {agentName} will not reply on it again.
          </p>
        )}
      </div>,
    )
  }

  return shell(
    <>
      <p style={{ fontSize: 11, letterSpacing: '.14em', color: '#8a8a90', margin: '0 0 12px', fontFamily: 'ui-monospace, monospace' }}>
        {agentName.toUpperCase()} · NEEDS YOU
      </p>
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,.07)', padding: 18 }}>
        <p style={{ fontSize: 15, fontWeight: 500, margin: '0 0 2px' }}>
          {who}{draft.channel ? ` · ${draft.channel}` : ''}
        </p>
        {draft.inbound_excerpt && (
          <p style={{ fontSize: 13, color: '#6b6b73', margin: '0 0 12px', lineHeight: 1.4 }}>
            They asked: {draft.inbound_excerpt}
          </p>
        )}
        {/* The reason, in the classifier's own words — the same line the inbox row shows. */}
        <p style={{ fontSize: 12, color: '#6b4708', background: '#fef3dc', borderRadius: 8, padding: '6px 9px', margin: '0 0 12px', display: 'inline-block' }}>
          {triggerLine(draft.reasons ?? [])}
        </p>

        <DecideForm
          token={token}
          draft={{
            who,
            channel: draft.channel,
            question: draft.inbound_excerpt,
            body: draft.body,
            trigger: triggerLine(draft.reasons ?? []),
            heldFor: heldSince(draft.created_at),
            agentName,
          }}
        />
      </div>
    </>,
  )
}
