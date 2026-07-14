import { describe, it, expect, afterEach } from 'vitest'
import {
  summarizeSupport, buildSupportQueue, deriveIssueType, isActionable,
  type SupportSignal, type AffectedTenant, type SupportOverlay, type SupportParams,
} from './support-ops'
import { roleWorkload, capacityDistribution, fullyLoadedMonthlyCents, costPerHeadCents, emptyRole, type TeamRole } from './capacity-v2'
import { __setSupportStoreDepsForTests, saveSupportOverlay, clearSupportOverlay, type SupportStoreDeps } from './support-store'
import { __setTeamStoreDepsForTests, saveTeamRole, deleteTeamRole, type TeamStoreDeps } from './team-store'
import { buildSupportSignals, __setOpsDepsForTests } from './ops-adapters'

afterEach(() => { __setSupportStoreDepsForTests(null); __setTeamStoreDepsForTests(null); __setOpsDepsForTests(null) })

const sig = (o: Partial<SupportSignal>): SupportSignal => ({ id: 'c1', kind: 'human_takeover', tenantId: 't1', channel: 'voice', ageHours: 10, createdAt: '2026-07-13T00:00:00.000Z', ...o })
const tenant = (o: Partial<AffectedTenant>): AffectedTenant => ({ name: 'Acme', plan: 'pro', mrrCents: 39700, isTrial: false, healthBucket: 'watch', lifecycle: 'established', ...o })
const PARAMS: SupportParams = { avgHandlingMinutes: 30, capacity: { headcount: 1, productiveHoursEachPerPeriod: 120, utilizationTarget: 0.8 }, nowMs: Date.parse('2026-07-13T12:00:00.000Z'), nowIso: '2026-07-13T12:00:00.000Z', slaHours: 48 }

describe('Support & Ops proxy (conversations are NOT tickets)', () => {
  it('excludes raw open conversations from actionable Scalix demand', () => {
    const signals = [
      sig({ id: 'o1', kind: 'open_conversation', ageHours: 200 }),
      sig({ id: 'o2', kind: 'open_conversation', ageHours: 200 }),
      sig({ id: 'h1', kind: 'human_takeover' }),
      sig({ id: 'f1', kind: 'message_failure', channel: 'sms', errorCode: '30034' }),
      sig({ id: 'd1', kind: 'channel_down', channel: 'instagram' }),
    ]
    const s = summarizeSupport(signals, new Map([['t1', tenant({})]]), PARAMS)
    expect(s.openConversationLoad.value).toBe(2)
    expect(s.openConversationLoad.caveat).toMatch(/NOT Scalix support demand/i)
    expect(s.actionableDemand.value).toBe(3) // takeover + failure + channel_down, NOT the 2 open convs
    expect(s.humanTakeoverLoad.value).toBe(1)
    expect(s.messageFailureLoad.value).toBe(1)
    expect(s.channelDownLoad.value).toBe(1)
    expect(signals.filter(isActionable).length).toBe(3)
  })

  it('demand hours exclude provisioning backlog; utilization is derived when capacity exists', () => {
    const signals = [sig({ id: 'a', kind: 'human_takeover' }), sig({ id: 'b', kind: 'message_failure' }), sig({ id: 'c', kind: 'channel_down' }), sig({ id: 'd', kind: 'channel_unverified' })]
    const s = summarizeSupport(signals, new Map(), PARAMS)
    expect(s.actionableDemand.value).toBe(3)          // provisioning (unverified) excluded from incidents
    expect(s.provisioningLoad.value).toBe(1)          // tracked separately as a backlog
    expect(s.demandHours.value).toBeCloseTo((3 * 30) / 60, 6) // 1.5h — incidents only
    expect(s.availableHours.value).toBe(120)
    expect(s.utilization.value).toBeCloseTo(1.5 / 120, 6)
    expect(s.demandHours.source).toBe('derived_actual')
    expect(s.availableHours.source).toBe('manual')
  })

  it('with no support capacity, utilization is empty (Manual), never a guess', () => {
    const s = summarizeSupport([sig({ kind: 'message_failure' })], new Map(), { ...PARAMS, capacity: { headcount: 0, productiveHoursEachPerPeriod: 120, utilizationTarget: 0.8 } })
    expect(s.utilization.value).toBeNull()
    expect(s.utilization.source).toBe('manual')
  })

  it('rolls up affected paying MRR and trials from actionable signals only', () => {
    const tenants = new Map<string, AffectedTenant>([
      ['t1', tenant({ mrrCents: 39700, isTrial: false })],
      ['t2', tenant({ name: 'Trialy', mrrCents: 0, isTrial: true })],
    ])
    const signals = [sig({ id: 'a', tenantId: 't1', kind: 'channel_down' }), sig({ id: 'b', tenantId: 't2', kind: 'message_failure' }), sig({ id: 'z', tenantId: 't1', kind: 'open_conversation' })]
    const s = summarizeSupport(signals, tenants, PARAMS)
    expect(s.customersAffected.value).toBe(2)
    expect(s.payingMrrAffectedCents.value).toBe(39700)
    expect(s.trialsAffected.value).toBe(1)
  })

  it('derives issue type from channel/kind and flags SLA risk by open duration', () => {
    expect(deriveIssueType(sig({ kind: 'channel_down' })).issue).toBe('integration')
    expect(deriveIssueType(sig({ kind: 'message_failure', channel: 'sms' })).issue).toBe('sms')
    expect(deriveIssueType(sig({ kind: 'human_takeover' })).issue).toBe('ai_quality')
    expect(deriveIssueType(sig({ kind: 'open_conversation', channel: 'weird' }))).toEqual({ issue: 'unknown', derived: false })
    const s = summarizeSupport([sig({ kind: 'channel_down', ageHours: 100 }), sig({ id: 'y', kind: 'message_failure', ageHours: 10 })], new Map(), PARAMS)
    expect(s.slaAtRisk.value).toBe(1) // only the 100h one exceeds 48h
    expect(s.slaAtRisk.source).toBe('estimate')
  })
})

describe('Support queue', () => {
  it('sorts by severity → MRR → age and applies the manual overlay without touching the source', () => {
    const tenants = new Map<string, AffectedTenant>([['t1', tenant({ mrrCents: 39700 })], ['t2', tenant({ name: 'Small', mrrCents: 0, isTrial: true })]])
    const overlays = new Map<string, SupportOverlay>([['c_hi', { signalId: 'c_hi', owner: 'Yoad', issueType: 'billing', severity: 'critical', status: 'investigating', notes: null, resolutionNote: null, updatedBy: 'y', updatedAt: 'x' }]])
    const signals = [
      sig({ id: 'c_lo', tenantId: 't2', kind: 'message_failure', channel: 'sms', ageHours: 5 }),
      sig({ id: 'c_hi', tenantId: 't1', kind: 'human_takeover', ageHours: 5 }),
      sig({ id: 'skipUsage', tenantId: 't1', kind: 'open_conversation', ageHours: 500 }),
      sig({ id: 'skipProv', tenantId: 't1', kind: 'channel_unverified', channel: 'sms', ageHours: 500 }),
    ]
    const q = buildSupportQueue(signals, tenants, overlays)
    expect(q.length).toBe(2) // open_conversation + provisioning excluded from incident queue
    expect(q[0].signalId).toBe('c_hi')
    expect(q[0].issue).toBe('billing')      // manual override wins
    expect(q[0].severity).toBe('critical')  // manual override wins
    expect(q[0].issueDerived).toBe(false)
    expect(q[0].owner).toBe('Yoad')
    expect(q[1].issue).toBe('sms')          // derived from the message-failure channel
  })
})

describe('Team capacity V2 (workload-based, never customer-count)', () => {
  const role = (o: Partial<TeamRole>): TeamRole => ({ ...emptyRole('r1'), role: 'Support', department: 'support', currentHeadcount: 1, capacityDriver: 'support_hours', capacityPerEmployee: 100, targetUtilization: 0.8, monthlySalaryCents: 600000, ...o })

  it('computes utilization, backlog, status and a hire rec when demand exceeds target capacity', () => {
    const w = roleWorkload(role({}), 90) // capacity 100, target 80
    expect(w.utilization).toBeCloseTo(0.9, 6)
    expect(w.status).toBe('near')          // >=0.8 target, <1.0
    expect(w.nextHireNeeded).toBe(true)    // 90 > 80 target capacity
    expect(w.recommendation).not.toBeNull()
    expect(w.recommendation!.monthlyCostCents).toBe(costPerHeadCents(role({})))
    expect(w.backlog).toBe(0)              // 90 < 100 raw capacity
  })

  it('flags overloaded with backlog when demand exceeds raw capacity', () => {
    const w = roleWorkload(role({ capacityPerEmployee: 50 }), 120) // capacity 50
    expect(w.status).toBe('overloaded')
    expect(w.backlog).toBe(70)
    expect(w.recommendation).not.toBeNull()
  })

  it('NEVER recommends a hire for a manual driver or when demand is unavailable', () => {
    expect(roleWorkload(role({ capacityDriver: 'manual' }), 999).recommendation).toBeNull()
    expect(roleWorkload(role({ capacityDriver: 'manual' }), 999).status).toBe('unknown')
    const noData = roleWorkload(role({ capacityDriver: 'sales_opportunities' }), null)
    expect(noData.recommendation).toBeNull()
    expect(noData.status).toBe('unknown')
    expect(noData.demandAvailable).toBe(false)
  })

  it('fully-loaded cost includes commission and payroll burden', () => {
    const r = role({ currentHeadcount: 2, monthlySalaryCents: 500000, commissionCents: 100000, payrollBurdenPct: 0.2 })
    expect(costPerHeadCents(r)).toBe(500000 + 100000 + 100000) // salary + commission + 20% burden
    expect(fullyLoadedMonthlyCents(r)).toBe(700000 * 2)
  })

  it('distribution buckets roles by status', () => {
    const ws = [roleWorkload(role({}), 90), roleWorkload(role({ capacityPerEmployee: 50 }), 120), roleWorkload(role({ capacityDriver: 'manual' }), 10)]
    expect(capacityDistribution(ws)).toEqual({ under: 0, healthy: 0, near: 1, overloaded: 1, unknown: 1 })
  })
})

function fakeSupportStore() {
  const rows = new Map<string, SupportOverlay>()
  const changes: Array<{ id: string; before: unknown; after: unknown }> = []
  const d: SupportStoreDeps = {
    getAll: async () => [...rows.values()],
    get: async (id) => rows.get(id) ?? null,
    upsert: async (id, patch, actor, at) => { rows.set(id, { ...(rows.get(id) ?? { signalId: id, owner: null, issueType: null, severity: null, status: null, notes: null, resolutionNote: null, updatedBy: null, updatedAt: null }), ...patch, updatedBy: actor, updatedAt: at } as SupportOverlay) },
    remove: async (id) => { rows.delete(id) },
    addChange: async (id, before, after) => { changes.push({ id, before, after }) },
  }
  return { d, rows, changes }
}
function fakeTeamStore() {
  const rows = new Map<string, TeamRole>()
  const changes: Array<{ id: string; before: unknown; after: unknown }> = []
  let n = 0
  const d: TeamStoreDeps = {
    getAll: async () => [...rows.values()],
    get: async (id) => rows.get(id) ?? null,
    insert: async (patch, actor, at) => { const id = `role_${++n}`; const r = { ...emptyRole(id), ...patch, updatedBy: actor, updatedAt: at } as TeamRole; rows.set(id, r); return r },
    update: async (id, patch, actor, at) => { rows.set(id, { ...(rows.get(id) as TeamRole), ...patch, updatedBy: actor, updatedAt: at }) },
    remove: async (id) => { rows.delete(id) },
    addChange: async (id, before, after) => { changes.push({ id, before, after }) },
  }
  return { d, rows, changes }
}

describe('Support overlay + Team roster persistence & audit', () => {
  it('support overlay persists and audits before/after; clear removes and audits', async () => {
    const { d, rows, changes } = fakeSupportStore(); __setSupportStoreDepsForTests(d)
    await saveSupportOverlay('sig1', { owner: 'Yoad', severity: 'high', issueType: 'billing' }, 'founder')
    expect(rows.get('sig1')!.owner).toBe('Yoad')
    expect(changes[0].before).toMatchObject({ signalId: 'sig1', owner: null })
    expect(changes[0].after).toMatchObject({ owner: 'Yoad', severity: 'high' })
    await clearSupportOverlay('sig1', 'founder')
    expect(rows.has('sig1')).toBe(false)
    expect(changes[1].after).toBeNull()
  })

  it('team role inserts (audit null→role), updates, and deletes with audit', async () => {
    const { d, rows, changes } = fakeTeamStore(); __setTeamStoreDepsForTests(d)
    const created = await saveTeamRole(null, { department: 'support', role: 'Support Specialist', currentHeadcount: 1, capacityDriver: 'support_hours', capacityPerEmployee: 120 }, 'founder')
    expect(changes[0].before).toBeNull()
    expect(rows.get(created.id)!.role).toBe('Support Specialist')
    await saveTeamRole(created.id, { currentHeadcount: 2 }, 'founder')
    expect(rows.get(created.id)!.currentHeadcount).toBe(2)
    expect(changes[1].before).toMatchObject({ currentHeadcount: 1 })
    await deleteTeamRole(created.id, 'founder')
    expect(rows.has(created.id)).toBe(false)
    expect(changes[2].after).toBeNull()
  })
})

describe('buildSupportSignals (raw rows → signals, open conversations kept separate)', () => {
  it('maps human_takeover/open/message-failure/channel signals with no content', () => {
    const nowMs = Date.parse('2026-07-13T12:00:00.000Z')
    const raw = {
      conversations: [
        { id: 'c1', tenant_id: 't1', channel: 'voice', status: 'open', human_takeover: true, created_at: '2026-07-10T00:00:00Z', updated_at: '2026-07-11T00:00:00Z' },
        { id: 'c2', tenant_id: 't1', channel: 'sms', status: 'open', human_takeover: false, created_at: '2026-07-01T00:00:00Z', updated_at: null },
        { id: 'c3', tenant_id: 't1', channel: 'email', status: 'resolved', human_takeover: false, created_at: '2026-07-01T00:00:00Z', updated_at: null },
      ],
      messageFailures: [{ id: 'm1', conversation_id: 'c9', tenant_id: 't1', channel: 'sms', error_code: '30034', timestamp: '2026-07-12T00:00:00Z' }],
      channels: [
        { id: 'ch1', tenant_id: 't1', type: 'instagram', status: 'disconnected', sms_status: null, created_at: '2026-07-01T00:00:00Z' },
        { id: 'ch2', tenant_id: 't1', type: 'sms', status: 'connected', sms_status: 'pending_verification', created_at: '2026-07-01T00:00:00Z' },
      ],
      partners: [],
    }
    const s = buildSupportSignals(raw, nowMs)
    expect(s.find((x) => x.id === 'c1')!.kind).toBe('human_takeover') // takeover wins over open
    expect(s.find((x) => x.id === 'c2')!.kind).toBe('open_conversation')
    expect(s.find((x) => x.id === 'c3')).toBeUndefined() // resolved, not open
    expect(s.find((x) => x.id === 'c9')!.kind).toBe('message_failure') // keyed by conversation_id
    expect(s.find((x) => x.id === 'ch1')!.kind).toBe('channel_down')
    expect(s.find((x) => x.id === 'ch2')!.kind).toBe('channel_unverified')
  })
})
