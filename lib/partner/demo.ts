import { browserScrapeHeaders } from '@/lib/scrape-headers'
import { createAdminClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createAdminClient>

/** Log a granular demo event (backbone for engagement + attribution + future replay). */
export async function logDemoEvent(db: Db, demoId: string, partnerId: string, eventType: string, visitorId?: string | null, meta?: Record<string, unknown>): Promise<void> {
  try { await db.from('demo_events').insert({ demo_id: demoId, partner_id: partnerId, visitor_id: visitorId || null, event_type: eventType, meta: meta || {} }) } catch { /* best-effort */ }
}

/**
 * Recompute + store a demo's engagement score (0–100) from time-on-demo, chat depth, and outcome.
 * A single deterministic signal partners can act on ("this prospect is hot").
 */
export async function updateDemoEngagement(db: Db, demoId: string): Promise<void> {
  try {
    const { data: d } = await db.from('demos').select('total_dwell_ms, view_count, chat_count, converted_trial, converted_paid').eq('id', demoId).maybeSingle()
    if (!d) return
    const dwellSec = d.view_count ? (d.total_dwell_ms || 0) / d.view_count / 1000 : 0
    const score = Math.min(100, Math.round(
      Math.min(dwellSec / 3, 30) +          // up to 30 for time
      Math.min((d.chat_count || 0) * 8, 30) + // up to 30 for chat depth
      (d.converted_trial ? 20 : 0) +
      (d.converted_paid ? 40 : 0)
    ))
    await db.from('demos').update({ engagement_score: score }).eq('id', demoId)
  } catch { /* best-effort */ }
}

// Builds the branding + AI briefing for a demo from the prospect's public site. Best-effort:
// every field degrades gracefully so a demo can always be generated, even with just a name.

export interface DemoInput {
  prospectName: string
  website?: string
  industry?: string
  phone?: string
  hours?: unknown
  faq?: { q: string; a: string }[]
}

export interface DemoBranding { logoUrl?: string; color?: string; siteTitle?: string; siteDescription?: string }

function absolutize(url: string, base: string): string {
  try { return new URL(url, base).toString() } catch { return url }
}

/** Scrape lightweight branding signals (title, description, og:image/favicon, theme-color). */
export async function scrapeBranding(website?: string): Promise<DemoBranding> {
  if (!website) return {}
  const url = /^https?:\/\//.test(website) ? website : `https://${website}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(url, { headers: browserScrapeHeaders(), signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return {}
    const html = (await res.text()).slice(0, 200_000)
    const pick = (re: RegExp) => html.match(re)?.[1]?.trim()
    const siteTitle = pick(/<title[^>]*>([^<]+)<\/title>/i)
    const siteDescription = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    const themeColor = pick(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
    const favicon = pick(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    const logo = ogImage || favicon
    return {
      siteTitle, siteDescription,
      logoUrl: logo ? absolutize(logo, url) : undefined,
      color: themeColor && /^#|rgb/.test(themeColor) ? themeColor : undefined,
    }
  } catch {
    return {}
  }
}

/** Compose the system briefing the demo AI uses to role-play as the prospect's receptionist. */
export function buildBriefing(input: DemoInput, branding: DemoBranding) {
  const faqText = (input.faq || []).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n')
  const systemPrompt = [
    `You are the friendly AI receptionist for "${input.prospectName}"${input.industry ? `, a ${input.industry} business` : ''}.`,
    branding.siteDescription ? `About the business: ${branding.siteDescription}` : '',
    input.phone ? `Business phone: ${input.phone}.` : '',
    input.hours ? `Business hours: ${JSON.stringify(input.hours)}.` : '',
    faqText ? `Known answers:\n${faqText}` : '',
    'Answer customer questions, book appointments, and capture leads. Be warm, concise, and helpful.',
    'This is a live demo of Scalix26 AI. Never say you are a language model; you are their AI employee.',
  ].filter(Boolean).join('\n')
  return { systemPrompt, greeting: `Hi! Thanks for contacting ${input.prospectName}. How can I help you today?` }
}
