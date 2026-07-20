import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforce, clientIp } from '@/lib/ratelimit'
import { looksLikeToken } from '@/lib/core/proposal-token'
import { resolvePublicProposal, respondToProposal } from '@/lib/core/proposals'

// PUBLIC (no auth). Token-scoped, rate-limited, fail-closed. GET records a view + returns customer-safe data;
// POST accepts/declines. The raw token never appears in logs and only the customer-safe shape is returned.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const flood = await enforce('proposals_public', `ip:${clientIp(req)}`)
  if (flood) return flood
  const { token } = await params
  if (!looksLikeToken(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const data = await resolvePublicProposal(token, { recordView: true })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

const schema = z.object({ action: z.enum(['accept', 'decline']), name: z.string().max(200).nullable().optional(), email: z.string().email().nullable().optional(), reason: z.string().max(2000).nullable().optional() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const flood = await enforce('proposals_public', `ip:${clientIp(req)}`)
  if (flood) return flood
  const { token } = await params
  if (!looksLikeToken(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { action, ...rest } = parsed.data
  const r = await respondToProposal(token, action, rest)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
