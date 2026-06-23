import { NextRequest, NextResponse } from 'next/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createClient } from '@/lib/supabase/server'
import { browserScrapeHeaders } from '@/lib/scrape-headers'

function extractText(html: string): string {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || ''
  const metas: string[] = title ? [`Title: ${title}`] : []

  const metaMatches = html.matchAll(/<meta[^>]+>/gi)
  for (const m of metaMatches) {
    const tag = m[0]
    const name = (tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1] || '').toLowerCase()
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1]?.trim()
    if (content && (name.includes('description') || name.includes('og:'))) {
      metas.push(`${name}: ${content}`)
    }
  }

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000)

  return [...metas, '', body].join('\n')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    const fetchRes = await fetch(url, {
      signal: controller.signal,
      headers: browserScrapeHeaders(),
    }).finally(() => clearTimeout(timeout))

    if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`)
    const html = await fetchRes.text()
    const text = extractText(html)

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Analyze this home services business website and extract information to train an AI customer assistant.

Return ONLY valid JSON (use null for fields not found — never invent data):
{
  "services": "comma-separated list of specific services (e.g. Emergency lockouts, Key duplication, Lock installation)",
  "pricing": "pricing details if mentioned (e.g. Starting from $75, Free estimates)",
  "description": "1-2 sentence description of what the business does and who they serve",
  "business_name": "business name or null",
  "phone": "phone number or null",
  "areas": "cities or regions served or null",
  "hours": "business hours or null"
}

Website content:
${text}`,
      }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    const data = JSON.parse(jsonMatch[0])
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== ''))
    return NextResponse.json(clean)
  } catch (err) {
    console.error(`[onboarding/scan-website] ${url} -> ${err instanceof Error ? err.message : 'failed'}`)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Scan failed' }, { status: 500 })
  }
}
