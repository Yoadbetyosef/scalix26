import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ElevenLabs voice IDs — available on free tier
const VOICE_MAP: Record<string, { voiceId: string; stability: number; similarity: number }> = {
  professional_female: { voiceId: 'XrExE9yKIg1WjnnlVkGX', stability: 0.75, similarity: 0.75 }, // Matilda - Professional
  professional_male:   { voiceId: 'onwK4e9ZLuTAKqWW03F9', stability: 0.75, similarity: 0.75 }, // Daniel - Steady Broadcaster
  friendly_female:     { voiceId: 'cgSgspJ2msm6clMCkdW9', stability: 0.50, similarity: 0.80 }, // Jessica - Playful & Warm
  friendly_male:       { voiceId: 'cjVigY5qzO86Huf0OWal', stability: 0.50, similarity: 0.80 }, // Eric - Smooth & Trustworthy
}

const SAMPLES: Record<string, string> = {
  professional_female: "Hi, thank you for calling. I'm here to help you schedule a service appointment. How can I assist you today?",
  professional_male:   "Hello, thank you for reaching out. How can I assist you with your service needs today?",
  friendly_female:     "Hey there! So glad you called! We'd love to help you out — what can we do for you today?",
  friendly_male:       "Hey! Thanks for calling! We're here to help. What can I do for you today?",
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { voiceId: voiceKey } = await req.json()
  const apiKey = process.env.ELEVENLABS_API_KEY

  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 503 })
  }

  const voice = VOICE_MAP[voiceKey]
  if (!voice) return NextResponse.json({ error: 'Unknown voice' }, { status: 400 })

  const text = SAMPLES[voiceKey]

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: voice.stability,
        similarity_boost: voice.similarity,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('ElevenLabs error:', err)
    return NextResponse.json({ error: 'TTS generation failed' }, { status: 500 })
  }

  const audioBuffer = await res.arrayBuffer()

  return new NextResponse(audioBuffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400', // cache 24h — same text, same audio
    },
  })
}
