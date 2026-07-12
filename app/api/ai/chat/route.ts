import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'
import { enforce } from '@/lib/ratelimit'

// Streaming Claude Haiku reply for the in-dashboard "Talk to your agent" demo.
// Streams raw text deltas so the client can start TTS on the first sentence
// instead of waiting for the whole reply (much faster, like the real call).
// Auth-gated (not a public route) so it can't be abused for free generation.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const limited = await enforce('ai_chat', `user:${user.id}`)
  if (limited) return limited

  const body = (await req.json().catch(() => ({}))) as { message?: unknown; system_prompt?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const system = typeof body.system_prompt === 'string' && body.system_prompt.trim()
    ? body.system_prompt
    : 'You are a helpful AI receptionist. Keep responses under 2 sentences.'

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const s = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 150,
        system,
        messages: [{ role: 'user', content: message }],
      })
      s.on('text', (delta) => { try { controller.enqueue(encoder.encode(delta)) } catch { /* closed */ } })
      s.on('end', () => { try { controller.close() } catch { /* closed */ } })
      s.on('error', () => { try { controller.close() } catch { /* closed */ } })
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
