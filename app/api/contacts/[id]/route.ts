import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { updateContact } from '@/lib/contacts/store'
import { contactFieldsSchema } from '@/lib/contacts/schema'
import { v2Allowed } from '@/lib/v2/access'

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

  // /v2-only today — the edit sheet is the sole caller and v1 has no contact edit at all. DELETE
  // THIS LINE when v1 gains one; it is a rollout gate, not a permission.
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!v2Allowed(c.tenantId, user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = contactFieldsSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  const r = await updateContact(id, parsed.data)
  if (!r.ok) {
    if (r.error === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: r.error, duplicateOf: r.duplicateOf }, { status: r.duplicateOf ? 409 : 400 })
  }
  return NextResponse.json({ ok: true, contact: r.contact })
}
