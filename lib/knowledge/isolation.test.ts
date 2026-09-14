import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// One tenant, several businesses, one AI employee each. Knowledge an agent scanned or was given
// belongs to that agent; a scan for one must never delete or feed another's.
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('knowledge stays with the business that owns it', () => {
  it('a website scan replaces only its own agent\'s rows and writes them scoped to that agent', () => {
    const s = src('app/api/agents/[id]/scan-website/route.ts')
    expect(s).toMatch(/\.eq\('source', WEBSITE_SOURCE\)\.eq\('origin_ai_employee_id', agentId\)/)
    expect(s).toMatch(/ai_employee_id: agentId, origin_ai_employee_id: agentId/)
    // The old shape — every website row in the tenant, written shared — must not come back.
    expect(s).not.toMatch(/delete\(\)\.eq\('tenant_id', agent\.tenant_id\)\.eq\('source', WEBSITE_SOURCE\)\n/)
    expect(s).not.toMatch(/ai_employee_id: null, origin_ai_employee_id: agentId/)
  })
  it('business details (pricing, areas) are the agent\'s, and another agent\'s are not overwritten', () => {
    const s = src('app/api/agents/[id]/business-details/route.ts')
    expect(s).toMatch(/\.or\(`origin_ai_employee_id\.eq\.\$\{agentId\},origin_ai_employee_id\.is\.null`\)/)
    expect(s).toMatch(/ai_employee_id: agentId, origin_ai_employee_id: agentId, title, content, source: 'template'/)
  })
  it('every reply path reads only its agent\'s rows plus shared ones', () => {
    expect(src('lib/email/reply.ts')).toMatch(/ai_employee_id\.eq\.\$\{opts\.agent\.id\},ai_employee_id\.is\.null/)
    expect(src('app/api/webhooks/twilio/voice/route.ts')).toMatch(/ai_employee_id\.eq\.\$\{agent\.id\},ai_employee_id\.is\.null/)
    expect(src('lib/anthropic/pipeline.ts')).toMatch(/ai_employee_id === employee\.id/)
  })
  it('the seed puts the appraisal Q&A on ONE agent, with prices in one editable entry', () => {
    const s = src('scripts/seed-appraisal-knowledge.mjs')
    expect(s).toMatch(/ai_employee_id: agentId, origin_ai_employee_id: agentId/)
    expect((s.match(/\$80/g) ?? []).length).toBe(1)
    expect((s.match(/\$120/g) ?? []).length).toBe(1)
  })
})

describe('email replies have a voice and a memory', () => {
  const s = src('lib/email/reply.ts')
  it('state who is speaking and for which business', () => {
    expect(s).toMatch(/You are \$\{name\}, writing from \$\{business\}/)
  })
  it('say what a good reply is NOT — the filler that reads as a robot', () => {
    expect(s).toMatch(/No "Thank you for reaching out"/)
    expect(s).toMatch(/never invent a price, a date or a policy/)
  })
  it('carry the thread as prior turns, normalised to alternate', () => {
    expect(s).toMatch(/history\?: Array<\{ role: 'user' \| 'assistant'; content: string \}>/)
    expect(s).toMatch(/while \(turns\.length && turns\[0\]\.role === 'assistant'\) turns\.shift\(\)/)
    expect(src('app/api/mailbox/poll/route.ts')).toMatch(/emailText: msg\.body \|\| '', subject: msg\.subject, history/)
  })
})
