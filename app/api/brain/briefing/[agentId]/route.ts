import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { loadBrainView } from '@/lib/brain/view'
import { briefingSegments, briefingText, BUSINESS_BRAIN_COO_VOICE_ID } from '@/lib/brain/present'

export const maxDuration = 30

// The COO's morning briefing — text + segments (for highlight sync) + cached audio.
// COST CONTROL: audio is generated ONCE per briefing text (version_key = hash) and cached in
// brain_briefings. Repeat plays reuse the cached audio — no repeated TTS cost. If ElevenLabs
// isn't configured, audio is null and the client falls back to browser speechSynthesis.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, tenantId } = ctx

  const view = await loadBrainView(admin, tenantId, agentId)
  const segments = briefingSegments(view)
  const text = briefingText(view)
  const version = createHash('sha256').update(text).digest('hex')

  // Cache hit → reuse (zero cost).
  let cached: { version_key?: string; audio_base64?: string | null } | null = null
  try { cached = (await admin.from('brain_briefings').select('version_key, audio_base64').eq('ai_employee_id', agentId).maybeSingle()).data } catch { /* table maybe absent */ }
  if (cached && cached.version_key === version) {
    return NextResponse.json({ text, segments, audio: cached.audio_base64 ? `data:audio/mpeg;base64,${cached.audio_base64}` : null, fallback: !cached.audio_base64, cached: true })
  }

  // Miss → generate once (if configured), then cache.
  let audioB64: string | null = null
  const key = process.env.ELEVENLABS_API_KEY
  if (key) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${BUSINESS_BRAIN_COO_VOICE_ID}`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: text.slice(0, 1200), model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.45, use_speaker_boost: true } }),
      })
      if (res.ok) audioB64 = Buffer.from(await res.arrayBuffer()).toString('base64')
    } catch { /* fall back to speechSynthesis */ }
  }

  try {
    await admin.from('brain_briefings').upsert(
      { tenant_id: tenantId, ai_employee_id: agentId, version_key: version, text, audio_base64: audioB64, created_at: new Date().toISOString() },
      { onConflict: 'ai_employee_id' },
    )
  } catch { /* cache best-effort */ }

  return NextResponse.json({ text, segments, audio: audioB64 ? `data:audio/mpeg;base64,${audioB64}` : null, fallback: !audioB64, cached: false })
}
