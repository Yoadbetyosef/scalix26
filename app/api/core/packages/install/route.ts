import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { installPackage, uninstallPackage } from '@/lib/core/packages'

// Install / upgrade / uninstall a vertical schema package for the active tenant. This is the explicit,
// per-tenant "safe install action" — a package is never auto-installed. tenant_id is server-derived.
const schema = z.object({ packageKey: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/) })

export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await installPackage(c.tenantId, parsed.data.packageKey, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

export async function DELETE(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await uninstallPackage(c.tenantId, parsed.data.packageKey)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
