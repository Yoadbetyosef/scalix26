import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { primaryAgent } from '@/lib/agents/primary'
import { speakAura } from '@/lib/deepgram/speak'
import { enforce } from '@/lib/ratelimit'

// The sandbox's voice. Same vendor as the phone now — this route used to call ElevenLabs through a
// map keyed by `professional_female | professional_male | friendly_female | friendly_male`, and since
// an Aura id was not a key in that map, EVERY agent configured with a real voice fell through to a
// hardcoded default. The sandbox could not speak the configured voice at all; that was the divergence.
//
// The route survives the vendor because it carries two things /api/tts deliberately does not: a
// logged-in user, and the tenant-scoped lookup of whose voice this is. /api/tts is public by
// necessity (Twilio fetches it) and is told which voice to use; here we work it out.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforce('ai_voice', `user:${user.id}`)
  if (limited) return limited

  const { text, voice } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'Text required' }, { status: 400 })

  // An explicit voice wins (nothing sends one today); otherwise the ACTIVE business's default agent —
  // the owner tenant, or the client tenant a White Label partner is operating. Never resolved from
  // user_id.
  let chosen: string | null = typeof voice === 'string' ? voice : null
  if (!chosen) {
    const activeTenantId = await getActiveTenantId()
    if (activeTenantId) {
      const agent = await primaryAgent<{ voice: string | null }>(createAdminClient(), activeTenantId, 'voice')
      chosen = agent?.voice ?? null
    }
  }

  // 900 rather than Deepgram's 2000: a sandbox reply that long is a bug in the reply, not a voice
  // budget, and this was the slice the route already applied.
  const audio = await speakAura(text.slice(0, 900), chosen)
  if (!audio.ok || !audio.body) {
    return NextResponse.json({ error: audio.error ?? 'TTS failed' }, { status: audio.status })
  }
  return new NextResponse(audio.body, { headers: { 'Content-Type': 'audio/mpeg' } })
}
