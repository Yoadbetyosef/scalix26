import { NextResponse } from 'next/server'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { getActuals } from '@/lib/command-center/actuals'

// GET → actual business metrics derived from verified sources (source: 'derived'), plus the metrics that
// aren't reliably derivable yet (source: 'manual', value null — never faked).
export async function GET() {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const asOf = new Date().toISOString()
  return NextResponse.json({ asOf, metrics: await getActuals(asOf) })
}
