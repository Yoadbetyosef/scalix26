import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'

// Short Claude Haiku reply for the in-dashboard "Talk to me" voice demo.
// Auth-gated (not a public route) so it can't be abused for free generation.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { message?: unknown; system_prompt?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const system = typeof body.system_prompt === 'string' && body.system_prompt.trim()
    ? body.system_prompt
    : 'You are a helpful AI receptionist. Keep responses under 2 sentences.'

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 150,
      system,
      messages: [{ role: 'user', content: message }],
    })
    const reply = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join(' ')
      .trim()
    return NextResponse.json({ reply })
  } catch (err) {
    console.error('[ai/chat] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 })
  }
}
