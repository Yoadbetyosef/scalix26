import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression guard for the Dashboard-chat (Amy) fix: the Business Context Layer block AND the real current
// date must be injected into the LLM prompt (both the planner and the responder). Mocks the model + data
// deps so it makes no network calls and captures the exact `system` strings sent to the model.

const createMock = vi.fn()
vi.mock('@/lib/anthropic/client', () => ({
  anthropic: { messages: { create: (...a: unknown[]) => createMock(...a) } },
  MODEL: 'm', VOICE_MODEL: 'v',
}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('./snapshot', () => ({ getBusinessSnapshot: async () => ({ text: 'SNAPSHOT_TEXT', generatedAt: '' }) }))
vi.mock('@/lib/timezone', () => ({ getBusinessTimezone: async () => 'America/New_York' }))
vi.mock('@/lib/brain/context/orchestrate', () => ({ assembleBusinessContext: async () => 'MOCK_BIZ_CONTEXT_BLOCK' }))
vi.mock('./registry', () => ({ amyTools: () => [], runTool: async () => '' }))

import { answerAsAmy } from './answer'

beforeEach(() => {
  createMock.mockReset()
  let n = 0
  createMock.mockImplementation(async () => {
    n++
    // 1st call = planner → return a 'finish' tool_use so the loop ends; 2nd = responder → text.
    return n === 1
      ? { content: [{ type: 'tool_use', id: 't1', name: 'finish', input: {} }] }
      : { content: [{ type: 'text', text: 'Final answer.' }] }
  })
})

describe('Dashboard chat (Amy) — Business Context + current date wiring', () => {
  it('injects the live Business Context block and the real current date into the LLM prompt', async () => {
    const out = await answerAsAmy({ tenantId: 't1', question: 'price of Martini Sofa?', employeeName: 'Amy', businessName: 'Acme' })
    expect(out).toBe('Final answer.')

    const systems = createMock.mock.calls.map((c) => (c[0] as { system: string }).system)
    // Business Context reaches the model (was completely absent before the fix).
    expect(systems.some((s) => s.includes('MOCK_BIZ_CONTEXT_BLOCK'))).toBe(true)
    // Real current-date anchor is present (currentDateContext is NOT mocked — runs for real).
    expect(systems.some((s) => s.includes('CURRENT DATE & TIME'))).toBe(true)
    // Both the planner and the responder prompts carry the context (so retrieval + answer agree).
    expect(systems.filter((s) => s.includes('MOCK_BIZ_CONTEXT_BLOCK')).length).toBeGreaterThanOrEqual(2)
  })
})
