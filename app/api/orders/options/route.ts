import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { addOption, listOptionLists } from '@/lib/orders/options'

// Tenant-managed dropdown options. Every handler is behind requireOrdersAccess and every store call
// re-scopes to the caller's tenant, so one tenant can never read or edit another's lists.

// ?all=1 includes deactivated options (the Settings manager); the order form gets active ones only.
export async function GET(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const includeInactive = req.nextUrl.searchParams.get('all') === '1'
  return NextResponse.json({ lists: await listOptionLists(!includeInactive) })
}

const addSchema = z.object({ listId: z.string().uuid(), label: z.string().min(1).max(200) })

export async function POST(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = addSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await addOption(parsed.data.listId, parsed.data.label)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json({ ok: true, option: r.option })
}
