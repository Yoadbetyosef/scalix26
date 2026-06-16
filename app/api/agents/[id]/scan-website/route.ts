import { NextRequest, NextResponse } from 'next/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Scraped content is written to knowledge_base with source='website' (distinct from
// 'manual' and 'template'), so a re-scan only replaces website entries and never
// touches the owner's manually-edited KB or the Business-Details template fields.
const WEBSITE_SOURCE = 'website'

const BODY_LIMIT = 12000

function extractText(html: string): string {
  // Meta/og tags first — usually the cleanest summary of the business.
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || ''
  const metas: string[] = title ? [`Title: ${title}`] : []
  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const tag = m[0]
    const name = (tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1] || '').toLowerCase()
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1]?.trim()
    if (content && (name.includes('description') || name.includes('og:') || name.includes('keywords'))) metas.push(`${name}: ${content}`)
  }
  // Image alt text often names products/services on JS-heavy/e-commerce sites.
  const alts: string[] = []
  for (const m of html.matchAll(/<img[^>]+alt=["']([^"']{3,})["']/gi)) alts.push(m[1].trim())

  let body = html
    // Drop non-content elements entirely (incl. JS/SVG/templates that pollute text).
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  // Remove inline-JS leftovers (Alpine/Shopify handlers leak when attr values contain '>').
  body = body
    .replace(/\{[^{}]*(?:=>|querySelector|\$store|\$dispatch|function\b|document\.|window\.|addEventListener)[^{}]*\}/g, ' ')
    .replace(/\b(?:const|let|var|function|return|setTimeout|querySelector|addEventListener)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()

  const altLine = alts.length ? `Image labels: ${[...new Set(alts)].slice(0, 40).join(', ')}` : ''
  return [...metas, altLine, '', body.slice(0, BODY_LIMIT)].filter(Boolean).join('\n')
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url } = await req.json()
  if (!url || !String(url).trim()) {
    // Empty website is fine — nothing to scan. Not an error.
    return NextResponse.json({ added: 0, message: 'No website URL provided.' })
  }

  // Verify the agent belongs to this user's tenant (admin client — no RLS surprises).
  const admin = createAdminClient()
  const { data: agent } = await admin.from('ai_employees').select('id, tenant_id').eq('id', agentId).single()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const { data: tenant } = await admin.from('tenants').select('id').eq('id', agent.tenant_id).eq('user_id', user.id).single()
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let target = String(url).trim()
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target

  // Fetch + AI-extract. Any failure here is graceful: return added:0 with a clear
  // message and HTTP 200 so the owner's save/flow is never blocked.
  let data: Record<string, unknown> = {}
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 12000)
    const res = await fetch(target, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScalixBot/1.0)', 'Accept': 'text/html' },
    }).finally(() => clearTimeout(t))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const text = extractText(html)
    console.log(`[agents/scan-website] ${target} | HTML ${html.length} chars | extracted ${text.length} chars`)
    if (text.length < 50) throw new Error('Could not read the website content')

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Analyze this business's website (ANY industry — services, retail, e-commerce, etc.) and extract information to train an AI customer assistant.

Return ONLY valid JSON. Use null only when the information is genuinely absent. NEVER invent or guess — especially pricing.
{
  "services": "comma-separated list of the main services OR products/offerings, or null",
  "pricing": "pricing details ONLY if explicitly stated (e.g. '50% off sitewide', 'Starting from $75', 'Free estimates', 'Free consultations'), else null",
  "areas": "cities/regions served if it's a local business, or null",
  "hours": "business hours if stated, or null",
  "description": "1-2 sentence description of what the business does and who it serves, or null"
}

Website content:
${text}`,
      }],
    })
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')
    data = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error('[agents/scan-website]', err instanceof Error ? err.message : err)
    return NextResponse.json({
      added: 0,
      error: "We couldn't read that website. Your details were saved — you can add services, pricing, and areas manually below.",
    })
  }

  // Map extracted fields -> KB entries, skipping null/empty. Pricing is included
  // ONLY if the site actually listed it (never invented).
  const FIELD_TITLES: [keyof typeof data, string][] = [
    ['services', 'Services'],
    ['pricing', 'Pricing'],
    ['areas', 'Service Areas'],
    ['hours', 'Business Hours'],
    ['description', 'About'],
  ]
  const items = FIELD_TITLES
    .map(([key, title]) => ({ title, content: String(data[key] ?? '').trim() }))
    .filter((it) => it.content && it.content.toLowerCase() !== 'null')

  if (items.length === 0) {
    return NextResponse.json({
      added: 0,
      message: 'We reached your site but found no usable details to add. You can fill them in manually below.',
    })
  }

  // Idempotent re-scan: replace prior website-sourced entries only; leave manual/template KB intact.
  await admin.from('knowledge_base').delete().eq('ai_employee_id', agentId).eq('source', WEBSITE_SOURCE)
  const rows = items.map((it) => ({
    tenant_id: agent.tenant_id, ai_employee_id: agentId, title: it.title, content: it.content, source: WEBSITE_SOURCE,
  }))
  const { error } = await admin.from('knowledge_base').insert(rows)
  if (error) {
    console.error('[agents/scan-website] KB insert failed:', error.message)
    return NextResponse.json({ added: 0, error: 'Could not save the website content. Please try again.' })
  }

  console.log(`[agents/scan-website] agent ${agentId}: added ${items.length} KB items from ${target}`)
  return NextResponse.json({ added: items.length, titles: items.map((i) => i.title) })
}
