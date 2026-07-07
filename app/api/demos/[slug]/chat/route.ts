import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'

// Public demo chat: the prospect talks to their would-be AI receptionist. Uses the precomputed
// briefing as the system prompt. Rate-limited by message length + short history. No auth.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { messages } = await req.json().catch(() => ({ messages: [] }))
  if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ error: 'No messages' }, { status: 400 })

  const db = createAdminClient()
  const { data: demo } = await db.from('demos').select('briefing').eq('public_slug', slug).maybeSingle()
  if (!demo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const briefing = (demo.briefing || {}) as { systemPrompt?: string }

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
    return NextResponse.json({ reply: text || "I'm here to help — could you say that another way?" })
  } catch (e) {
    console.error('[demo chat] failed:', (e as Error).message)
    return NextResponse.json({ reply: 'Sorry, I had trouble responding just now. Please try again.' })
  }
}
