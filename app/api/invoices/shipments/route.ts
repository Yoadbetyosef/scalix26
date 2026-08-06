import { NextRequest, NextResponse } from 'next/server'
import { createShipmentFromFile, listShipments } from '@/lib/invoices/store'

// Supplier invoices in, shipments out.
//
// Extraction runs HERE rather than in the catalog worker. The worker is a poll-driven job runner built
// for crawls that take minutes against someone else's hosting; this is user-initiated and synchronous —
// the owner uploads a file and waits to see the lines. A ten-second poll floor is the wrong shape for
// that, and a second job type would couple this feature's deploys to a service whose whole justification
// is sharing nothing with the request path.
//
// 300s matches the ceiling already used by learning/run, brain/cron and partner/cron. A large invoice
// spends most of it inside one streamed model call.
export const maxDuration = 300

const fail = (reason: 'not_found' | 'forbidden', error?: string) =>
  reason === 'forbidden'
    ? NextResponse.json({ error: error || 'You do not have permission to view supplier costs.' }, { status: 403 })
    : NextResponse.json({ error: error || 'Not found' }, { status: 404 })

export async function GET() {
  const r = await listShipments()
  if (!r.ok) return fail(r.reason, r.error)
  return NextResponse.json({ shipments: r.data })
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })

  try {
    const r = await createShipmentFromFile(file)
    if (!r.ok) {
      // A rejected file (wrong format, too large) is a 400 with the reason the person needs, not a 404.
      if (r.error) return NextResponse.json({ error: r.error }, { status: r.reason === 'forbidden' ? 403 : 400 })
      return fail(r.reason)
    }
    return NextResponse.json(r.data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Could not read that invoice.' }, { status: 400 })
  }
}
