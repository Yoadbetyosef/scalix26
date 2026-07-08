import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { anthropic, MODEL } from '@/lib/anthropic/client'

// The AI Sales Coach writes a personalized outreach message for a niche. Cheap, on-demand.
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { niche, channel, city } = await req.json().catch(() => ({}))
  const kind = channel === 'sms' ? 'a short SMS (under 320 chars)' : 'a concise cold email (subject + 90-130 words)'
  const target = [niche || 'local service businesses', city ? `in ${city}` : ''].filter(Boolean).join(' ')

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: 'You are an expert B2B sales copywriter for Scalix26, an AI employee that answers calls/texts 24/7, books jobs, and captures leads for small businesses. Write outreach that a Scalix26 partner sends to prospects. Be specific, warm, and focused on missed-call revenue. End with a soft CTA to see a free personalized AI demo. No placeholders like [Name] beyond one greeting token. Output only the message.',
      messages: [{ role: 'user', content: `Write ${kind} to ${target}. Emphasize how many leads they lose from missed calls and that Scalix26's AI answers instantly and books the job.` }],
    })
    const text = resp.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n').trim()
    return NextResponse.json({ message: text })
  } catch (e) {
    console.error('[coach email] failed:', (e as Error).message)
    return NextResponse.json({ error: 'Could not generate right now — try again.' }, { status: 500 })
  }
}
