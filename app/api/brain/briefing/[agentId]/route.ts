import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { loadBrainView } from '@/lib/brain/view'
import { briefingSegments, briefingText, BUSINESS_BRAIN_COO_VOICE } from '@/lib/brain/present'
import { speakAuraBuffer } from '@/lib/deepgram/speak'
import { enforce } from '@/lib/ratelimit'

export const maxDuration = 30

// The COO's morning briefing — text + segments (for highlight sync) + cached audio.
// COST CONTROL: audio is generated ONCE per briefing text (version_key = hash) and cached in
// brain_briefings. Repeat plays reuse the cached audio — no repeated TTS cost. If Deepgram
// isn't configured, audio is null and the client falls back to browser speechSynthesis.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, tenantId } = ctx
  const limited = await enforce('brain_read', `tenant:${tenantId}`)
  if (limited) return limited

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

  // Miss → generate once, then cache. speakAura never throws and returns null when unconfigured or
  // upstream fails, so the client's speechSynthesis fallback still covers it.
  const audio = await speakAuraBuffer(text.slice(0, 1200), BUSINESS_BRAIN_COO_VOICE)
  const audioB64: string | null = audio ? audio.toString('base64') : null

  try {
    await admin.from('brain_briefings').upsert(
      { tenant_id: tenantId, ai_employee_id: agentId, version_key: version, text, audio_base64: audioB64, created_at: new Date().toISOString() },
      { onConflict: 'ai_employee_id' },
    )
  } catch { /* cache best-effort */ }

  return NextResponse.json({ text, segments, audio: audioB64 ? `data:audio/mpeg;base64,${audioB64}` : null, fallback: !audioB64, cached: false })
}
