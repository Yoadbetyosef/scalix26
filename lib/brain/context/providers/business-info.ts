import type { ContextProvider } from '../types'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
function hoursLine(h: Record<string, string> | null | undefined): string | null {
  if (!h || typeof h !== 'object') return null
  const parts = DAYS.filter((d) => h[d]).map((d) => `${d[0].toUpperCase()}${d.slice(1)} ${h[d]}`)
  return parts.length ? parts.join(', ') : null
}

// Business hours + Location (address/phone). alwaysOn: small, business-wide, safe — so even realtime voice
// (which has no transcript at prompt-build time) gets these common facts.
export const businessInfoProvider: ContextProvider = {
  key: 'business_info',
  label: 'Business Hours & Location',
  keywords: ['hours', 'open', 'close', 'closed', 'opening', 'location', 'address', 'where are you', 'directions', 'phone', 'call you', 'contact'],
  alwaysOn: true,
  async fetch(req, db) {
    const { data: t } = await db
      .from('tenants')
      .select('business_name, business_hours, address, city, state, zip, phone, timezone')
      .eq('id', req.tenantId)
      .maybeSingle()
    if (!t) return { available: false, text: 'Business profile is unavailable.' }
    // Per-agent hours override the tenant default when present.
    let hours = hoursLine(t.business_hours as Record<string, string>)
    if (req.agentId) {
      const { data: a } = await db.from('ai_employees').select('business_hours').eq('id', req.agentId).maybeSingle()
      const agentHours = hoursLine(a?.business_hours as Record<string, string>)
      if (agentHours) hours = agentHours
    }
    const addr = [t.address, t.city, t.state, t.zip].filter(Boolean).join(', ')
    const lines: string[] = []
    lines.push(hours ? `Hours: ${hours}${t.timezone ? ` (${t.timezone})` : ''}` : 'Hours: not set — do not state specific opening hours.')
    lines.push(addr ? `Address: ${addr}` : 'Address: not on file — do not invent a location. (This business has a single location; there are no other branches in the system.)')
    if (t.phone) lines.push(`Phone: ${t.phone}`)
    return { available: true, text: lines.join('\n') }
  },
}
