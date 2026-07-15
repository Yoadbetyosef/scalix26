import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { detectProviders, assembleBusinessContext } from './orchestrate'
import { PROVIDERS } from './registry'
import type { ContextProvider } from './types'

const db = {} as unknown as SupabaseClient // fake providers below never touch it
const req = (query: string) => ({ tenantId: 't', agentId: 'a', channel: 'sms', query })

const fake: ContextProvider[] = [
  { key: 'alpha', label: 'Alpha', keywords: ['alpha', 'aaa'], async fetch() { return { available: true, text: 'a-data' } } },
  { key: 'beta', label: 'Beta', keywords: ['beta'], async fetch() { return { available: false, text: 'no beta data' } } },
  { key: 'ess', label: 'Essentials', keywords: [], alwaysOn: true, async fetch() { return { available: true, text: 'ess-data' } } },
]

describe('Business Context — detection', () => {
  it('matches providers by keyword, plus alwaysOn ones', () => {
    const keys = detectProviders('do you have ALPHA in stock', false, fake).map((p) => p.key)
    expect(keys).toContain('alpha')
    expect(keys).toContain('ess')       // alwaysOn always included
    expect(keys).not.toContain('beta')  // not mentioned
  })
  it('essentialsOnly returns only alwaysOn providers (e.g. realtime voice)', () => {
    expect(detectProviders('alpha beta', true, fake).map((p) => p.key)).toEqual(['ess'])
  })
  it('empty query returns only alwaysOn providers', () => {
    expect(detectProviders('', false, fake).map((p) => p.key)).toEqual(['ess'])
  })
  it('real registry: order questions pull the orders provider; catalog questions the catalog provider', () => {
    expect(detectProviders('where is my order ORD-7ENTQWCN', false, PROVIDERS).map((p) => p.key)).toContain('orders')
    expect(detectProviders('how much does the gold ring cost', false, PROVIDERS).map((p) => p.key)).toContain('catalog')
    expect(detectProviders('do you have any discounts', false, PROVIDERS).map((p) => p.key)).toContain('promotions')
  })
})

describe('Business Context — assembly + no-hallucination contract', () => {
  it('renders a delimited block with a header forbidding invention', async () => {
    const out = await assembleBusinessContext(req('alpha'), { providers: fake, db })
    expect(out).toContain('[LIVE BUSINESS DATA]')
    expect(out.toLowerCase()).toContain('not available')
    expect(out).toContain('## Alpha')
    expect(out).toContain('a-data')
    expect(out).toContain('## Essentials') // alwaysOn included
  })
  it('unavailable modules render their explicit "unavailable" text (not omitted)', async () => {
    const out = await assembleBusinessContext(req('beta'), { providers: fake, db })
    expect(out).toContain('## Beta')
    expect(out).toContain('no beta data')
  })
  it('returns empty string when nothing is relevant (no alwaysOn, no match)', async () => {
    const noEssentials = fake.filter((p) => !p.alwaysOn)
    expect(await assembleBusinessContext(req('totally unrelated'), { providers: noEssentials, db })).toBe('')
  })
  it('a throwing provider degrades to unavailable, never breaks assembly', async () => {
    const boom: ContextProvider[] = [{ key: 'boom', label: 'Boom', keywords: ['boom'], async fetch() { throw new Error('db down') } }]
    const out = await assembleBusinessContext(req('boom'), { providers: boom, db })
    expect(out).toContain('## Boom')
    expect(out).toContain('temporarily unavailable')
  })
})
