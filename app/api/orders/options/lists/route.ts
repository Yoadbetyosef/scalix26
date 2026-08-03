import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { applyTemplate, createList } from '@/lib/orders/options'
import { OPTION_TEMPLATES } from '@/lib/orders/option-templates'

// GET — the starter templates on offer. Applying one is always an explicit choice; nothing is seeded
// for a tenant automatically, so no trade inherits another trade's vocabulary.
export async function GET() {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    templates: OPTION_TEMPLATES.map((t) => ({
      id: t.id, name: t.name, description: t.description,
      lists: t.lists.map((l) => ({ label: l.label, count: l.options.length })),
    })),
  })
}

const schema = z.union([
  z.object({ template: z.string().min(1).max(60) }),
  z.object({ label: z.string().min(1).max(120) }),
])

// POST — either apply a template, or create one empty list of the tenant's own.
export async function POST(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  if ('template' in parsed.data) {
    const r = await applyTemplate(parsed.data.template)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, created: r.created })
  }
  const r = await createList(parsed.data.label)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, id: r.id })
}
