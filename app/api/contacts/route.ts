import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { createContact } from '@/lib/contacts/store'

const schema = z.object({
  name: z.string().max(300).nullable().optional(),
  // Blank is allowed (the form may only have a name); a non-empty value must still look like an address.
  email: z.union([z.string().email().max(320), z.literal('')]).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  currency: z.string().max(8).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const c = await requireActiveBusinessContext()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await createContact(parsed.data)
  // A duplicate is a 409 with the existing record attached, so the UI can offer it instead.
  if (!r.ok) return NextResponse.json({ error: r.error, duplicateOf: r.duplicateOf }, { status: r.duplicateOf ? 409 : 400 })
  return NextResponse.json({ ok: true, contact: r.contact })
}
