import { NextRequest, NextResponse } from 'next/server'
import { contactFieldsSchema } from '@/lib/contacts/schema'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { createContact } from '@/lib/contacts/store'

// The same six fields the edit route writes, from one schema so the two cannot drift. They were
// byte-identical when this was split — which is exactly how two copies start.
const schema = contactFieldsSchema

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
