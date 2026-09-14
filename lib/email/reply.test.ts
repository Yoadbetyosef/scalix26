import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildEmailSystemPrompt, normalizeHistory } from './reply'
import { knowledgeRowVisibleTo } from '@/lib/knowledge/scope'

// The two businesses on TG's tenant, as the agent rows and knowledge they actually have, and the
// emails customers actually send. The model is not called; what is tested is everything that
// decides what it can say: who it is, which facts it may use, and what it is told to do when it
// does not know.
const T = 'tenant-tg'
const ALEX = { id: 'alex', name: 'Alex', system_prompt: '', business_name: 'TG Jewellers', personality: 'friendly', industry: 'Jewelry Industry' }
const AVI = { id: 'avi', name: 'Avi', system_prompt: '', business_name: 'Vancouver Gem Lab', personality: 'friendly', industry: 'Appraisals' }
const KB = [
  { tenant_id: T, ai_employee_id: 'alex', title: 'Services', content: 'Custom engagement rings, tennis bracelets, repairs. Granville Street, Vancouver.' },
  { tenant_id: T, ai_employee_id: 'avi', title: 'Appraisal pricing', content: 'Standard appraisal: from $80 per piece. Watches and antique pieces: $120 to $250.' },
  { tenant_id: T, ai_employee_id: 'avi', title: 'Insurance appraisals', content: 'Q: What is an insurance appraisal? A: A written, signed document…' },
  { tenant_id: T, ai_employee_id: null, title: 'Business Hours', content: 'Mon–Fri 9–5' },
]
const kbFor = (agentId: string) => KB.filter((r) => knowledgeRowVisibleTo(r, T, agentId)).map((r) => `## ${r.title}\n${r.content}`).join('\n\n')
const promptFor = (agent: typeof ALEX) => buildEmailSystemPrompt({ agent, tenantBusinessName: 'TG jewellers', kb: kbFor(agent.id) })

const EMAILS = [
  'How much is an appraisal?', "I inherited my mother's ring.", 'Can you tell me what my Rolex is worth?',
  'I want a custom tennis bracelet.', 'Do you have my estimate ready?', 'Can I pay a deposit?', 'Where is my CAD?', 'Can I book for Thursday?',
]

describe('who is speaking', () => {
  it('each agent is its own business and is told not to answer for the other', () => {
    expect(promptFor(ALEX)).toMatch(/You are Alex, writing from TG Jewellers/)
    expect(promptFor(AVI)).toMatch(/You are Avi, writing from Vancouver Gem Lab/)
    for (const p of [promptFor(ALEX), promptFor(AVI)]) expect(p).toMatch(/you do not answer for any other business/)
  })
  it('signs off as the person and the business, never as a template', () => {
    expect(promptFor(ALEX)).toMatch(/Sign off with your first name and the business name/)
    expect(promptFor(ALEX)).toMatch(/No "Thank you for reaching out"/)
  })
})

describe('what each business may know', () => {
  it("Avi answers 'How much is an appraisal?' from its pricing entry; Alex has no appraisal price to give", () => {
    expect(promptFor(AVI)).toContain('Standard appraisal: from $80 per piece')
    expect(promptFor(ALEX)).not.toContain('$80')
    expect(promptFor(ALEX)).not.toContain('Appraisal pricing')
  })
  it("Alex answers 'I want a custom tennis bracelet' from TG's services; Avi does not carry TG's services", () => {
    expect(promptFor(ALEX)).toContain('tennis bracelets')
    expect(promptFor(AVI)).not.toContain('tennis bracelets')
  })
  it('shared rows (hours) reach both; nothing else crosses', () => {
    expect(promptFor(ALEX)).toContain('Mon–Fri 9–5')
    expect(promptFor(AVI)).toContain('Mon–Fri 9–5')
  })
  it('the prompt says the knowledge base is the ONLY source of facts, and what to do without one', () => {
    const p = promptFor(ALEX)
    expect(p).toMatch(/the only source of facts about the business/)
    expect(p).toMatch(/never invent a price, a date or a policy/)
  })
})

describe('the questions that need a person', () => {
  it.each(EMAILS)('"%s" — the prompt tells the assistant what not to guess', (email) => {
    const p = promptFor(ALEX)
    if (/estimate|deposit|CAD/i.test(email)) expect(p).toMatch(/status of a specific order, estimate, CAD, deposit or delivery is not in your knowledge base\. Do not guess/)
    if (/worth|inherited/i.test(email)) expect(p).toMatch(/cannot; say so kindly and invite them to bring it in/)
    if (/book/i.test(email)) expect(p).toMatch(/Never confirm a specific slot yourself/)
    expect(p).toMatch(/Two to five sentences/)
  })
})

describe('the thread', () => {
  it('is normalised to alternating turns starting with the customer', () => {
    const turns = normalizeHistory([
      { role: 'assistant', content: 'stray' }, { role: 'user', content: 'Hi' }, { role: 'user', content: 'again' },
      { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'trailing (the email being answered)' },
    ])
    expect(turns).toEqual([{ role: 'user', content: 'Hi\n\nagain' }, { role: 'assistant', content: 'Hello' }])
  })
  it('is what the mailbox poll passes', () => {
    expect(readFileSync(new URL('../../app/api/mailbox/poll/route.ts', import.meta.url), 'utf8')).toMatch(/subject: msg\.subject, history/)
  })
})
