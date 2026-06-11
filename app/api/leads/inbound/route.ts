import { NextResponse } from 'next/server'

// Deprecated: the open endpoint accepted tenant_id in the body, which let any
// caller submit leads (and trigger SMS) for any tenant. Lead sources must now
// POST to their unique secret URL: /api/leads/inbound/<token>
// (find it under Settings → Lead Sources).
export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint is deprecated. Use your unique intake URL: /api/leads/inbound/<your-token> (Settings → Lead Sources).',
    },
    { status: 410 },
  )
}
