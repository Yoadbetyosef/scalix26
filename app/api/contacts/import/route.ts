import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { commitImport, previewImport } from '@/lib/contacts/store'

// Bulk contact import. The file is parsed and mapped in the browser; this endpoint receives plain rows.
// `preview` classifies without writing (new / already-in-book / unusable) so nothing is a surprise;
// `commit` re-runs the same classification server-side before inserting — the preview is never trusted
// as authorisation to write.

const row = z.object({
  name: z.string().max(300).optional(), email: z.string().max(320).optional(), phone: z.string().max(50).optional(),
  address: z.string().max(1000).optional(), currency: z.string().max(8).optional(), notes: z.string().max(5000).optional(),
})
const schema = z.object({ mode: z.enum(['preview', 'commit']), rows: z.array(row).max(20000) })

export async function POST(req: NextRequest) {
  const c = await requireActiveBusinessContext()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  if (parsed.data.mode === 'preview') {
    const preview = await previewImport(parsed.data.rows)
    if (!preview) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ ok: true, preview })
  }
  const r = await commitImport(parsed.data.rows)
  if (!r.ok) return NextResponse.json({ error: r.error, created: r.created }, { status: 400 })
  return NextResponse.json({ ok: true, created: r.created })
}
