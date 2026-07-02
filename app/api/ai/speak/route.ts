import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // Explicit voice override (e.g. the AI COO always speaks in a professional male voice).
  if (voice && VOICE_MAP[voice]) {
    voiceId = VOICE_MAP[voice]
  } else {
    // Otherwise use the tenant's active AI employee voice.
    const serviceSupabase = await createServiceClient()
    const { data: tenant } = await serviceSupabase
      .from('tenants').select('id').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (tenant) {
      const { data: employee } = await serviceSupabase
        .from('ai_employees').select('voice').eq('tenant_id', tenant.id)
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
      text: text.slice(0, 900), // cap length (a COO briefing is a few sentences)
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.65, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) return NextResponse.json({ error: 'TTS failed' }, { status: 500 })

  const audio = await res.arrayBuffer()
  return new NextResponse(audio, {
    headers: { 'Content-Type': 'audio/mpeg' },
  })
}
