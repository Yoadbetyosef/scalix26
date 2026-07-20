import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { listContacts, createContactWithDedupe } from '@/lib/core/contacts'

// GET /api/core/contacts?archived=1 — the tenant's contacts (customers). Contacts are auto-populated from
// conversations; this is the directory view. Tenant from the guard; gated by the contacts module.
export async function GET(req: NextRequest) {
  const c = await requireCoreTenant('contacts')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const includeArchived = new URL(req.url).searchParams.get('archived') === '1'
  return NextResponse.json({ contacts: await listContacts(c.tenantId, { includeArchived }) })
}

// POST — create a new contact (e.g. from the proposal builder), with duplicate protection. Returns
// { created:false, duplicates } when an existing contact shares the email/phone and force is not set.
const schema = z.object({
  name: z.string().min(1).max(300), companyName: z.string().max(300).nullable().optional(),
  email: z.string().max(320).nullable().optional(), phone: z.string().max(60).nullable().optional(),
  address: z.string().max(1000).nullable().optional(), notes: z.string().max(4000).nullable().optional(),
  force: z.boolean().optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCoreTenant('contacts')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
  const email = parsed.data.email?.trim()
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  const r = await createContactWithDedupe(c.tenantId, c.actor, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
