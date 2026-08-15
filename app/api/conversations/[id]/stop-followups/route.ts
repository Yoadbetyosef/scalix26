import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { stopDripsForPhone } from '@/lib/leads/drip'

// STOP FOLLOWING UP WITH THIS PERSON — the decision, named for what it does.
//
// It used to be "Dismiss", on a list, beside a name and a phone number. But dismissing a lead is not
// filing: it is the brake on an outbound SMS sequence, and it was the only brake a normally-handled
// customer had. The one place that decision is INFORMED is the conversation — where the owner has
// just read what was said and concluded this is a wrong number, a competitor, or not a customer.
//
// So it lives on the thread, and the control only appears when something is actually running.
//
// Two effects, in the order that matters if the second fails: the sequences stop, and the leads are
// marked dismissed so nothing restarts them. Operator-safe — the tenant comes only from the validated
// active-workspace context, and the conversation must belong to it.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: conv } = await admin
    .from('conversations')
    .select('id, tenant_id, contact:contacts(id, phone)')
    .eq('id', id)
    .maybeSingle()
  if (!conv || conv.tenant_id !== ctx.tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const contact = conv.contact as unknown as { id: string; phone: string | null } | null
  if (!contact) return NextResponse.json({ ok: true, stopped: 0, note: 'Nobody is attached to this conversation.' })

  const { data: leads } = await admin
    .from('leads')
    .select('id, phone, status')
    .eq('tenant_id', ctx.tenantId)
    .eq('contact_id', contact.id)
  const rows = (leads ?? []) as { id: string; phone: string | null; status: string }[]
  const open = rows.filter((l) => ['new', 'contacted', 'called_back'].includes(l.status))

  // Every number this person is known by — the lead's own and the contact's — because the campaign
  // was created with whichever one reached intake.
  const phones = [...new Set([contact.phone, ...rows.map((l) => l.phone)].filter(Boolean))] as string[]
  let stopped = 0
  for (const phone of phones) {
    stopped += (await stopDripsForPhone(admin, ctx.tenantId, phone, `stopped from conversation ${id}`)).stopped
  }

  if (open.length) {
    const { error } = await admin
      .from('leads')
      .update({ status: 'dismissed' })
      .in('id', open.map((l) => l.id))
      .eq('tenant_id', ctx.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    stopped,
    // Said in the owner's words, because the screen shows it verbatim — the same contract the send
    // route's `note` has.
    note: stopped > 0
      ? `${stopped === 1 ? 'One follow-up' : `${stopped} follow-ups`} stopped.`
      : 'Nothing was following up with them.',
  })
}
