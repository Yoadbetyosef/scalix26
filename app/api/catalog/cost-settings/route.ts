import { NextResponse } from 'next/server'
import { getCostSettingsForSession } from '@/lib/catalog/costs'

// The cost card's settings, for a screen with no product to ask about yet — the Add form.
//
// Same principle as the per-product cost endpoint: the ENDPOINT decides whether this session may see
// costs, and the card is only its reflection. A 403 here means the card renders nothing and the Add
// form carries on exactly as it does for any session without cost visibility — the product still
// saves, there is simply no cost section. Nothing about creating a product depends on this answer.
export async function GET() {
  const r = await getCostSettingsForSession()
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === 'forbidden' ? 403 : 404 })
  return NextResponse.json({ settings: r.data })
}
