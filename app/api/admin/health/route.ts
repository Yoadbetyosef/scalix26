import { NextResponse } from 'next/server'
import { getAdminContext } from '@/lib/admin/rbac'

type Status = 'operational' | 'degraded' | 'down' | 'not_configured'
interface Check { service: string; status: Status; ms: number | null; detail?: string }

// One live probe with a timeout. 2xx = operational (degraded if slow), else down.
async function probe(service: string, url: string, headers: Record<string, string>): Promise<Check> {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 5000)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    const ms = Date.now() - t0
    if (res.ok) return { service, status: ms > 2500 ? 'degraded' : 'operational', ms }
    return { service, status: 'down', ms, detail: `HTTP ${res.status}` }
  } catch (e) {
    return { service, status: 'down', ms: Date.now() - t0, detail: (e as Error).name === 'AbortError' ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(to)
  }
}

const notConfigured = (service: string): Check => ({ service, status: 'not_configured', ms: null })

// GET /api/admin/health — live status of every external dependency.
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const env = process.env
  const checks: Promise<Check>[] = []

  checks.push(
    env.ANTHROPIC_API_KEY
      ? probe('Anthropic (LLM)', 'https://api.anthropic.com/v1/models', { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' })
      : Promise.resolve(notConfigured('Anthropic (LLM)')),
  )
  checks.push(
    env.OPENAI_API_KEY
      ? probe('OpenAI', 'https://api.openai.com/v1/models', { Authorization: `Bearer ${env.OPENAI_API_KEY}` })
      : Promise.resolve(notConfigured('OpenAI')),
  )
  checks.push(
    env.DEEPGRAM_API_KEY
      ? probe('Deepgram', 'https://api.deepgram.com/v1/projects', { Authorization: `Token ${env.DEEPGRAM_API_KEY}` })
      : Promise.resolve(notConfigured('Deepgram')),
  )
  checks.push(
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
      ? probe('Twilio', `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, {
          Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        })
      : Promise.resolve(notConfigured('Twilio')),
  )
  checks.push(
    env.STRIPE_SECRET_KEY
      ? probe('Stripe', 'https://api.stripe.com/v1/balance', { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` })
      : Promise.resolve(notConfigured('Stripe')),
  )
  const metaId = env.META_APP_ID, metaSecret = env.META_APP_SECRET
  checks.push(
    metaId && metaSecret
      ? probe('Meta (Facebook / Instagram)', `https://graph.facebook.com/v19.0/${metaId}?fields=id&access_token=${metaId}|${metaSecret}`, {})
      : Promise.resolve(notConfigured('Meta (Facebook / Instagram)')),
  )
  checks.push(Promise.resolve(notConfigured('Google')))
  checks.push(Promise.resolve(notConfigured('Microsoft')))

  const services = await Promise.all(checks)
  const anyDown = services.some((s) => s.status === 'down')
  const anyDegraded = services.some((s) => s.status === 'degraded')
  const overall: Status = anyDown ? 'down' : anyDegraded ? 'degraded' : 'operational'

  return NextResponse.json({ overall, services, checkedAt: new Date().toISOString() })
}
