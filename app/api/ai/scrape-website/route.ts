import { NextRequest, NextResponse } from 'next/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  try {
    // Fetch the website
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Scalix26Bot/1.0)' },
      signal: AbortSignal.timeout(10000),
    })
    const html = await res.text()

    // Strip HTML tags for Claude
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 8000)

    // Ask Claude to extract business info
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Extract business information from this website content. Return ONLY valid JSON with these fields (use null for unknown):
{
  "business_name": "string",
  "industry": "string (one of: HVAC, Plumbing, Electrical, Cleaning, Landscaping, Roofing, Pest Control, Handyman, Pool Service, Other)",
  "phone": "string",
  "address": "string",
  "city": "string",
  "state": "string",
  "zip": "string",
  "email": "string"
}

Website content:
${text}`,
      }],
    })

    const text2 = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const jsonMatch = text2.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')

    const data = JSON.parse(jsonMatch[0])
    return NextResponse.json(data)
  } catch (err) {
    console.error('Scrape error:', err)
    return NextResponse.json({ error: 'Failed to scan website' }, { status: 500 })
  }
}
