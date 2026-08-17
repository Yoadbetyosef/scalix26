import { NextRequest, NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { updateContact } from '@/lib/contacts/store'
import { contactFieldsSchema } from '@/lib/contacts/schema'

// Edit one contact. Six fields, the same six create writes, from the same schema.
//
// A key that is absent is untouched; a key present and blank is CLEARED — see updateContact, where
// that distinction is the reason `manual_fields` exists.
//
// A collision answers 409 with `duplicateOf` attached, exactly as POST /api/contacts does, so the UI
// has ONE shape for "this person is already in your book". When merge lands from
// scalix-core-platform-foundation this is where it gets offered, and the route does not change.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await requireActiveBusinessContext()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The v2-only rollout gate that stood here is GONE, as its own comment instructed: v1 has an edit
  // form now (components/contacts/contact-edit.tsx) and there are two callers. It was never a
  // permission — requireActiveBusinessContext above is, and it is tenant-scoped and version-agnostic.

  const parsed = contactFieldsSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  const r = await updateContact(id, parsed.data)
  if (!r.ok) {
    if (r.error === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: r.error, duplicateOf: r.duplicateOf }, { status: r.duplicateOf ? 409 : 400 })
  }
  return NextResponse.json({ ok: true, contact: r.contact })
}
