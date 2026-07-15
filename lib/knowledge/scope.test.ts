import { describe, it, expect } from 'vitest'
import { agentKnowledgeOrFilter, knowledgeOwnerForWrite, knowledgeRowVisibleTo, knowledgeVisibility } from './scope'

const T = 'tenant-A', T2 = 'tenant-B', A = 'agent-1', B = 'agent-2'
const shared = { tenant_id: T, ai_employee_id: null }
const agentA = { tenant_id: T, ai_employee_id: A }
const otherTenant = { tenant_id: T2, ai_employee_id: null }

describe('Business Knowledge ownership model', () => {
  it('shared (tenant-wide) knowledge is visible to every agent in the tenant', () => {
    expect(knowledgeRowVisibleTo(shared, T, A)).toBe(true)
    expect(knowledgeRowVisibleTo(shared, T, B)).toBe(true)
    expect(knowledgeRowVisibleTo(shared, T, null)).toBe(true) // no-agent context still sees shared
  })

  it('agent-specific knowledge is visible ONLY to that agent (plus shared)', () => {
    expect(knowledgeRowVisibleTo(agentA, T, A)).toBe(true)
    expect(knowledgeRowVisibleTo(agentA, T, B)).toBe(false) // sibling agent cannot see it
    expect(knowledgeRowVisibleTo(agentA, T, null)).toBe(false)
  })

  it('cross-tenant knowledge is never visible (isolation)', () => {
    expect(knowledgeRowVisibleTo(otherTenant, T, A)).toBe(false)
    expect(knowledgeRowVisibleTo({ tenant_id: T2, ai_employee_id: A }, T, A)).toBe(false)
  })

  it('read filter returns tenant-wide OR active agent; tenant-wide only when no agent', () => {
    expect(agentKnowledgeOrFilter(A)).toBe('ai_employee_id.is.null,ai_employee_id.eq.agent-1')
    expect(agentKnowledgeOrFilter(null)).toBe('ai_employee_id.is.null')
  })

  it('new knowledge defaults to shared; agent-specific only on explicit opt-out', () => {
    expect(knowledgeOwnerForWrite(true, A)).toBe(null)   // shared
    expect(knowledgeOwnerForWrite(false, A)).toBe(A)     // this agent only
    expect(knowledgeOwnerForWrite(false, null)).toBe(null)
  })

  it('visibility label distinguishes shared vs agent', () => {
    expect(knowledgeVisibility(null)).toBe('shared')
    expect(knowledgeVisibility(A)).toBe('agent')
  })
})
