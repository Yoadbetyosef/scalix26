import { NextResponse } from 'next/server'
import { getFounderContext, type FounderContext } from './guard'

// API access gate for /api/admin/command-center/*. Non-founders (or flag off) get a 404 — never a 403 that
// would reveal the endpoint exists. Use at the top of every founder API handler.
export async function requireFounderApi(): Promise<FounderContext | NextResponse> {
  const f = await getFounderContext()
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return f
}
