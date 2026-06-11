import { NextRequest, NextResponse } from 'next/server'

// Text-to-speech proxy for the voice call flow. Twilio's <Play> fetches this
// URL; we stream Deepgram Aura audio back as audio/mpeg.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const text = searchParams.get('text') || ''
  // tenant_id is accepted for future per-tenant voice selection (unused for now)

  if (!text) {
    return new NextResponse('Missing text', { status: 400 })
  }

  try {
    const ttsStart = Date.now()
    console.log(`[tts][latency] Deepgram START @ ${new Date(ttsStart).toISOString()} | text.len=${text.length}`)
    const res = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })
    console.log(`[tts][latency] Deepgram responded | took ${Date.now() - ttsStart}ms | status=${res.status}`)

    if (!res.ok || !res.body) {
      const err = await res.text().catch(() => '')
      console.error('[tts] Deepgram error:', res.status, err.slice(0, 200))
      return new NextResponse('TTS failed', { status: 502 })
    }

    return new NextResponse(res.body, {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  } catch (err) {
    console.error('[tts] request failed:', err instanceof Error ? err.message : err)
    return new NextResponse('TTS failed', { status: 502 })
  }
}
