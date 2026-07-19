import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { listDefinitions, createDefinition } from '@/lib/core/fields'

// Manage attribute definitions (the tenant/vertical "schema"). Broader config admin lands in Phase 7;
// this is the product-schema surface used to install a vertical's fields.
const FIELD_TYPES = ['text', 'long_text', 'integer', 'decimal', 'money', 'boolean', 'date', 'datetime', 'select', 'multi_select', 'file', 'image', 'contact_relation', 'company_relation', 'product_relation', 'variant_relation', 'user_relation', 'record_relation'] as const

export async function GET(req: NextRequest) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const entityType = new URL(req.url).searchParams.get('entity_type') || 'product'
  return NextResponse.json({ definitions: await listDefinitions(c.tenantId, entityType) })
}

const schema = z.object({
  entityType: z.string().min(1).max(40), key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/), label: z.string().min(1).max(200),
  fieldType: z.enum(FIELD_TYPES), required: z.boolean().optional(),
  validation: z.object({ min: z.number().optional(), max: z.number().optional(), maxLength: z.number().optional() }).optional(),
  sortOrder: z.number().int().optional(),
  options: z.array(z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) })).optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createDefinition(c.tenantId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
