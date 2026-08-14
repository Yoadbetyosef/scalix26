import { auraVoice } from '@/lib/voices'

// ONE CALL TO THE ONE TTS VENDOR.
//
// Three routes each held their own copy of a text-to-speech fetch — /api/tts (Deepgram, serving every
// phone call), /api/ai/speak (ElevenLabs) and the Business Brain briefing (ElevenLabs again, with its
// own voice id and expressive settings). Two vendors, three implementations, and the sandbox one was
// the only surface a person could hear next to the phone, which is how the divergence stayed
// invisible for so long.
//
// Deepgram Aura serves all three. Verified against the live endpoint: `aura-2-arcas-en` returns 200
// `audio/mpeg`, and text over the limit returns 413 `Input text exceeds maximum character limit of
// 2000` — which is why callers slice before they get here.

/** Deepgram rejects anything longer with a 413. Callers slice to their own budget; this is the wall. */
export const MAX_TTS_CHARS = 2000

export interface SpeakResult {
  ok: boolean
  status: number
  /** The MP3 stream. Null when the request failed. */
  body: ReadableStream<Uint8Array> | null
  error?: string
}

/**
 * Synthesise `text` as MP3. Never throws — a TTS failure must degrade to silence or a fallback voice,
 * never take down the call or the page that asked for it.
 */
export async function speakAura(text: string, voice?: string | null): Promise<SpeakResult> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) return { ok: false, status: 503, body: null, error: 'DEEPGRAM_API_KEY not configured' }

  const clean = text.slice(0, MAX_TTS_CHARS)
  if (!clean.trim()) return { ok: false, status: 400, body: null, error: 'Missing text' }

  try {
    // auraVoice() is the injection guard as well as the fallback: the value is interpolated into the
    // URL, so it is matched against the Aura id shape rather than escaped.
    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${auraVoice(voice)}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
    })

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      console.error('[tts] Deepgram error:', res.status, detail.slice(0, 200))
      return { ok: false, status: 502, body: null, error: 'TTS failed' }
    }
    return { ok: true, status: 200, body: res.body }
  } catch (err) {
    console.error('[tts] request failed:', err instanceof Error ? err.message : err)
    return { ok: false, status: 502, body: null, error: 'TTS failed' }
  }
}

/** The same call, buffered — for the callers that cache the audio rather than stream it. */
export async function speakAuraBuffer(text: string, voice?: string | null): Promise<Buffer | null> {
  const r = await speakAura(text, voice)
  if (!r.ok || !r.body) return null
  return Buffer.from(await new Response(r.body).arrayBuffer())
}
