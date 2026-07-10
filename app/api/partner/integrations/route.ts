import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'
import { getIntegrations, saveIntegration, reverifyIntegration, disconnectIntegration, KEY_PROVIDERS, type Provider } from '@/lib/partner/integrations'

// White Label infrastructure connections. Reads return status/masked hints only — never secrets.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ integrations: await getIntegrations(ctx.partnerId) })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!KEY_PROVIDERS.includes(b.provider)) return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  try {
    const res = await saveIntegration(ctx.partnerId, b.provider as Provider, b.credentials || {})
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Could not save integration' }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!KEY_PROVIDERS.includes(b.provider)) return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  return NextResponse.json(await reverifyIntegration(ctx.partnerId, b.provider as Provider))
}

export async function DELETE(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const provider = new URL(req.url).searchParams.get('provider') as Provider
  if (!KEY_PROVIDERS.includes(provider)) return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  await disconnectIntegration(ctx.partnerId, provider)
  return NextResponse.json({ success: true })
}
