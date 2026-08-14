import { NextRequest, NextResponse } from 'next/server'
import { stripMarkdown } from '@/lib/utils'
import { speakAura } from '@/lib/deepgram/speak'
import { enforce, clientIp } from '@/lib/ratelimit'

// Text-to-speech for the voice call flow. Twilio's <Play> fetches this URL; we stream Deepgram Aura
// audio back as audio/mpeg. The upstream call itself lives in lib/deepgram/speak.ts — this route is
// the public, GET-shaped, flood-capped door onto it, because Twilio can only fetch a URL.
export async function GET(req: NextRequest) {
  // Twilio fetches many segments per call from rotating IPs, so use the generous flood cap (not the
  // tight AI policy) — blocks a scripted abuser running up Deepgram cost without throttling real calls.
  const limited = await enforce('webhook', `tts-ip:${clientIp(req)}`)
  if (limited) return limited

  const { searchParams } = new URL(req.url)
  const text = stripMarkdown(searchParams.get('text') || '')
  if (!text) return new NextResponse('Missing text', { status: 400 })

  const ttsStart = Date.now()
  console.log(`[tts][latency] Deepgram START @ ${new Date(ttsStart).toISOString()} | text.len=${text.length}`)
  // An unknown or absent voice becomes the default rather than an upstream 400 — same rule the
  // whitelist regex enforced here before, now shared with every other caller.
  const audio = await speakAura(text, searchParams.get('voice'))
  console.log(`[tts][latency] Deepgram responded | took ${Date.now() - ttsStart}ms | ok=${audio.ok}`)

  if (!audio.ok || !audio.body) return new NextResponse('TTS failed', { status: audio.status })
  return new NextResponse(audio.body, { headers: { 'Content-Type': 'audio/mpeg' } })
}
