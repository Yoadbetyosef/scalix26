import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'
import { logDemoEvent, updateDemoEngagement } from '@/lib/partner/demo'

// Public demo chat: the prospect talks to their would-be AI receptionist. Uses the precomputed
// briefing as the system prompt. Rate-limited by message length + short history. No auth.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = await req.json().catch(() => ({ messages: [] }))
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ error: 'No messages' }, { status: 400 })

  const db = createAdminClient()
  const { data: demo } = await db.from('demos').select('id, partner_id, briefing, chat_count').eq('public_slug', slug).maybeSingle()
  if (!demo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const briefing = (demo.briefing || {}) as { systemPrompt?: string }
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId : null

  // Keep the last 10 turns, cap each message length.
  const history = messages.slice(-10).map((m: { role: string; content: string }) => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: String(m.content || '').slice(0, 1000),
  }))

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: briefing.systemPrompt || 'You are a friendly AI receptionist. Be warm and concise.',
      messages: history,
    })
    const text = resp.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n')
    const reply = text || "I'm here to help — could you say that another way?"

    // Record the transcript (recording/replay) + engagement (best-effort, non-blocking).
    const lastUser = String(history[history.length - 1]?.content || '')
    Promise.resolve().then(async () => {
      await db.from('demo_chat_messages').insert([
        { demo_id: demo.id, partner_id: demo.partner_id, visitor_id: visitorId, role: 'user', content: lastUser },
        { demo_id: demo.id, partner_id: demo.partner_id, visitor_id: visitorId, role: 'assistant', content: reply.slice(0, 2000) },
      ])
      await db.from('demos').update({ chat_count: (demo.chat_count || 0) + 1 }).eq('id', demo.id)
      await logDemoEvent(db, demo.id, demo.partner_id, 'chat', visitorId, { q: lastUser.slice(0, 120) })
      await updateDemoEngagement(db, demo.id)
    }).catch(() => {})

    return NextResponse.json({ reply })
  } catch (e) {
    console.error('[demo chat] failed:', (e as Error).message)
    return NextResponse.json({ reply: 'Sorry, I had trouble responding just now. Please try again.' })
  }
}
