import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { cronAuthorized } from '@/lib/reviews'
import { generateEmailReply } from '@/lib/email/reply'
import { sendEmailReply } from '@/lib/email/send'

// Cron worker: send the due email auto-replies. A thread the owner took over
// (human_takeover) is skipped — the "I'll handle this" window. Run via
// cron-job.org every minute (Vercel Hobby crons are daily only).
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = await createServiceClient()
  const nowIso = new Date().toISOString()
  const clearDue = (id: string) => supabase.from('conversations').update({ email_reply_due_at: null, updated_at: nowIso }).eq('id', id)

  const { data: due } = await supabase
    .from('conversations')
    .select('id, tenant_id, contact_id, summary, human_takeover')
    .eq('channel', 'email')
    .eq('status', 'open')
    .lte('email_reply_due_at', nowIso)
    .limit(50)

  let sent = 0, skipped = 0
  for (const conv of due || []) {
    if (conv.human_takeover) { await clearDue(conv.id); skipped++; continue }

    const { data: agent } = await supabase
      .from('ai_employees').select('id, name, system_prompt, business_name, email_auto_reply, reply_from_email')
      .eq('tenant_id', conv.tenant_id).eq('status', 'active').maybeSingle()
    if (!agent || !agent.email_auto_reply) { await clearDue(conv.id); skipped++; continue }

    const { data: contact } = await supabase.from('contacts').select('email').eq('id', conv.contact_id).maybeSingle()
    if (!contact?.email) { await clearDue(conv.id); skipped++; continue }

    const { data: msgs } = await supabase.from('messages')
      .select('content').eq('conversation_id', conv.id).eq('role', 'user').order('timestamp', { ascending: false }).limit(1)
    const emailText = msgs?.[0]?.content || ''

    const { data: tenant } = await supabase.from('tenants').select('business_name').eq('id', conv.tenant_id).maybeSingle()

    try {
      const reply = await generateEmailReply({
        tenantId: conv.tenant_id, agent, tenantBusinessName: tenant?.business_name ?? null, emailText, subject: conv.summary || '',
      })
      const r = await sendEmailReply(contact.email, agent.reply_from_email, conv.summary || '', reply)
      if (r.success) {
        await supabase.from('messages').insert({ conversation_id: conv.id, tenant_id: conv.tenant_id, role: 'assistant', content: reply, channel: 'email' })
        sent++
      }
    } catch (err) {
      console.error('[email-process] reply failed for', conv.id, err instanceof Error ? err.message : err)
    }
    await clearDue(conv.id)
  }

  return NextResponse.json({ ok: true, processed: due?.length || 0, sent, skipped })
}

export const GET = handle
export const POST = handle
