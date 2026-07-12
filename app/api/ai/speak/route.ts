import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { enforce } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforce('ai_voice', `user:${user.id}`)
  if (limited) return limited

  const { text, voice } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'Text required' }, { status: 400 })

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No TTS key' }, { status: 503 })

  const VOICE_MAP: Record<string, string> = {
    professional_female: 'XrExE9yKIg1WjnnlVkGX', // Matilda
    professional_male:   'onwK4e9ZLuTAKqWW03F9', // Daniel
    friendly_female:     'cgSgspJ2msm6clMCkdW9', // Jessica
    friendly_male:       'cjVigY5qzO86Huf0OWal', // Eric
  }

  let voiceId = 'onwK4e9ZLuTAKqWW03F9' // Daniel (default)

  // The AI COO: a warm, natural, conversational male voice — should NOT sound like an AI.
  const isCoo = voice === 'coo'
  if (isCoo) {
    voiceId = 'cjVigY5qzO86Huf0OWal' // Eric — relaxed, human, conversational
  } else if (voice && VOICE_MAP[voice]) {
    voiceId = VOICE_MAP[voice]
  } else {
    // Otherwise use the ACTIVE business's active AI employee voice (owner tenant, or the operated
    // client tenant) — never resolved from user_id.
    const activeTenantId = await getActiveTenantId()
    if (activeTenantId) {
      const { data: employee } = await createAdminClient()
        .from('ai_employees').select('voice').eq('tenant_id', activeTenantId)
        .eq('status', 'active').limit(1).maybeSingle()
      if (employee?.voice && VOICE_MAP[employee.voice]) voiceId = VOICE_MAP[employee.voice]
    }
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text.slice(0, 900),
      // COO → higher-quality model + expressive settings (lower stability = more human/varied).
      model_id: isCoo ? 'eleven_multilingual_v2' : 'eleven_turbo_v2_5',
      voice_settings: isCoo
        ? { stability: 0.4, similarity_boost: 0.85, style: 0.45, use_speaker_boost: true }
        : { stability: 0.65, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) return NextResponse.json({ error: 'TTS failed' }, { status: 500 })

  const audio = await res.arrayBuffer()
  return new NextResponse(audio, {
    headers: { 'Content-Type': 'audio/mpeg' },
  })
}
