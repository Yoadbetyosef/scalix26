import { NextRequest, NextResponse } from 'next/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createClient } from '@/lib/supabase/server'
import { browserScrapeHeaders } from '@/lib/scrape-headers'

function extractFromHtml(html: string): string {
  // Extract meta tags (title, description, og tags)
  const metas: string[] = []
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
  if (title) metas.push(`Title: ${title}`)

  const metaMatches = html.matchAll(/<meta[^>]+>/gi)
  for (const m of metaMatches) {
    const tag = m[0]
    const name = (tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1] || '').toLowerCase()
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1]?.trim()
    if (content && (
      name.includes('description') || name.includes('og:') ||
      name.includes('business') || name.includes('phone') || name.includes('address')
    )) {
      metas.push(`${name}: ${content}`)
    }
  }

  // Extract schema.org / LD+JSON structured data — has phone, address, name
  const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1])
      metas.push(`Structured data: ${JSON.stringify(parsed).slice(0, 1000)}`)
    } catch { /* ignore */ }
  }

  // Clean body text
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)

  return [...metas, '', 'Page content:', bodyText].join('\n')
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

    let html = ''
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: browserScrapeHeaders(),
      })
      clearTimeout(timeout)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      html = await res.text()
    } catch (fetchErr) {
      clearTimeout(timeout)
      throw fetchErr
    }

    const text = extractFromHtml(html)

    if (text.length < 50) {
      throw new Error('Could not extract content from website')
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Extract business information from this website data. Return ONLY valid JSON with these exact fields (use null for unknown fields, never make up data):
{
  "business_name": "string or null",
  "industry": "one of: HVAC, Plumbing, Electrical, Cleaning, Landscaping, Roofing, Pest Control, Handyman, Pool Service, Other — or null",
  "phone": "string or null",
  "address": "string or null",
  "city": "string or null",
  "state": "2-letter state code or null",
  "zip": "string or null",
  "email": "string or null"
}

Website data:
${text}`,
      }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    const data = JSON.parse(jsonMatch[0])
    // Remove null values so they don't overwrite existing data
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== ''))
    return NextResponse.json(clean)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[ai/scrape-website] ${url} -> ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
