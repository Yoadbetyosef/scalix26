import { describe, it, expect, afterEach } from 'vitest'
import {
  summarizeSupport, buildSupportQueue, deriveIssueType, isActionable,
  type SupportSignal, type AffectedTenant, type SupportOverlay, type SupportParams,
} from './support-ops'
import {
  roleWorkload, capacityDistribution, headcountView, costPerHeadCents, realityPayrollCents, planPayrollCents, normalizePeriod,
  type TeamRealityRole, type HiringPlanRole, type CapacityModel,
} from './capacity-v2'
import { __setSupportStoreDepsForTests, saveSupportOverlay, clearSupportOverlay, type SupportStoreDeps } from './support-store'
import { __setCapacityModelDepsForTests, saveCapacityModel, type CapacityModelDeps } from './capacity-model-store'
import { __setTeamRealityDepsForTests, saveTeamRealityRole, closeTeamRealityRole, type TeamRealityDeps } from './team-reality-store'
import { __setHiringPlanDepsForTests, saveHiringPlan, deleteHiringPlan, moveHireToReality, type HiringPlanDeps } from './hiring-plan-store'
import { buildSupportSignals } from './ops-adapters'

afterEach(() => { __setSupportStoreDepsForTests(null); __setCapacityModelDepsForTests(null); __setTeamRealityDepsForTests(null); __setHiringPlanDepsForTests(null) })

const sig = (o: Partial<SupportSignal>): SupportSignal => ({ id: 'c1', kind: 'human_takeover', tenantId: 't1', channel: 'voice', ageHours: 10, createdAt: '2026-07-13T00:00:00.000Z', ...o })
const tenant = (o: Partial<AffectedTenant>): AffectedTenant => ({ name: 'Acme', plan: 'pro', mrrCents: 39700, isTrial: false, healthBucket: 'watch', lifecycle: 'established', ...o })
const PARAMS: SupportParams = { avgHandlingMinutes: 30, weeklyCapacityHours: 120, nowMs: Date.parse('2026-07-13T12:00:00.000Z'), nowIso: '2026-07-13T12:00:00.000Z', slaHours: 48 }

describe('Support & Ops proxy (conversations are NOT tickets)', () => {
  it('excludes raw open conversations from actionable Scalix demand', () => {
    const signals = [
      sig({ id: 'o1', kind: 'open_conversation', ageHours: 200 }), sig({ id: 'o2', kind: 'open_conversation', ageHours: 200 }),
      sig({ id: 'h1', kind: 'human_takeover' }), sig({ id: 'f1', kind: 'message_failure', channel: 'sms', errorCode: '30034' }), sig({ id: 'd1', kind: 'channel_down', channel: 'instagram' }),
    ]
    const s = summarizeSupport(signals, new Map([['t1', tenant({})]]), PARAMS)
    expect(s.openConversationLoad.value).toBe(2)
    expect(s.openConversationLoad.caveat).toMatch(/NOT Scalix support demand/i)
    expect(s.actionableDemand.value).toBe(3)
    expect(signals.filter(isActionable).length).toBe(3)
  })

  it('backlog vs weekly demand; utilization uses weekly demand ÷ weekly capacity (same period)', () => {
    const signals = [sig({ id: 'a', kind: 'human_takeover' }), sig({ id: 'b', kind: 'message_failure' }), sig({ id: 'c', kind: 'channel_down' }), sig({ id: 'd', kind: 'channel_unverified' })]
    const s = summarizeSupport(signals, new Map(), PARAMS)
    expect(s.actionableDemand.value).toBe(3)           // provisioning excluded
    expect(s.provisioningLoad.value).toBe(1)
    expect(s.demandHours.value).toBeCloseTo((3 * 30) / 60, 6)        // backlog = 1.5h
    expect(s.weeklyDemandHours.value).toBeCloseTo((3 * 30) / 60, 6)  // all 3 within 7d → 1.5h/week
    expect(s.availableHours.value).toBe(120)
    expect(s.utilization.value).toBeCloseTo(1.5 / 120, 6)
    expect(s.availableHours.source).toBe('manual')
  })

  it('with no support capacity, utilization is empty (Manual), never a guess', () => {
    const s = summarizeSupport([sig({ kind: 'message_failure' })], new Map(), { ...PARAMS, weeklyCapacityHours: 0 })
    expect(s.utilization.value).toBeNull()
    expect(s.utilization.source).toBe('manual')
  })

  it('rolls up affected paying MRR and trials from actionable signals only', () => {
    const tenants = new Map<string, AffectedTenant>([['t1', tenant({ mrrCents: 39700, isTrial: false })], ['t2', tenant({ name: 'Trialy', mrrCents: 0, isTrial: true })]])
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
    const s = summarizeSupport([sig({ kind: 'channel_down', ageHours: 100 }), sig({ id: 'y', kind: 'message_failure', ageHours: 10 })], new Map(), PARAMS)
    expect(s.slaAtRisk.value).toBe(1)
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
    expect(q.length).toBe(2)
    expect(q[0].signalId).toBe('c_hi')
    expect(q[0].issue).toBe('billing')
    expect(q[0].severity).toBe('critical')
    expect(q[0].issueDerived).toBe(false)
    expect(q[1].issue).toBe('sms')
  })
})

// ── Team & Capacity V2 (Reality / Plan / Config) ───────────────────────────────────────────────────────
const model = (o: Partial<CapacityModel>): CapacityModel => ({ id: 'm1', roleKey: 'csm', label: 'CSM', capacityDriver: 'cs_customers', capacityPerEmployee: 120, capacityUnit: 'active_customers', capacityPeriod: 'month', demandMetricKey: null, targetUtilization: 0.8, sourceClassification: 'manual', effectiveFrom: '2026-07-01', effectiveTo: null, status: 'active', notes: null, updatedBy: null, updatedAt: null, ...o })
const rrole = (o: Partial<TeamRealityRole>): TeamRealityRole => ({ id: 'r1', department: 'customer_success', role: 'CSM', currentHeadcount: 1, monthlySalaryCents: 600000, commissionCents: 0, payrollBurdenPct: 0.2, capacityModelId: 'm1', effectiveFrom: '2026-07-01', effectiveTo: null, status: 'active', notes: null, updatedBy: null, updatedAt: null, ...o })
const hrole = (o: Partial<HiringPlanRole>): HiringPlanRole => ({ id: 'h1', department: 'support', role: 'Support Rep', headcount: 1, plannedStartDate: '2026-08-01', monthlySalaryCents: 500000, commissionCents: 0, payrollBurdenPct: 0.2, capacityModelId: null, hiringReason: null, growthEngine: null, priority: 'high', status: 'proposed', notes: null, updatedBy: null, updatedAt: null, ...o })

describe('Capacity engine (period-normalized, per-driver, reality-only)', () => {
  it('stock driver: utilization = demand ÷ capacity; recommends a hire past target', () => {
    const w = roleWorkload(rrole({}), model({}), { value: 100 }) // capacity 120, target 96
    expect(w.driverKind).toBe('stock')
    expect(w.utilization).toBeCloseTo(100 / 120, 6)
    expect(w.status).toBe('near')
    expect(w.nextHireNeeded).toBe(true)
    expect(w.backlog).toBe(0) // 100 < 120
    expect(w.recommendation!.monthlyCostCents).toBe(costPerHeadCents(600000, 0, 0.2)) // 720000
  })

  it('rate driver normalizes demand and capacity to the same period', () => {
    const supModel = model({ capacityDriver: 'support_hours', capacityPerEmployee: 40, capacityPeriod: 'week', capacityUnit: 'productive_hours' })
    const weekly = roleWorkload(rrole({ department: 'support' }), supModel, { value: 36, period: 'week' })
    expect(weekly.driverKind).toBe('rate')
    expect(weekly.utilization).toBeCloseTo(0.9, 6)
    // demand supplied per DAY must be normalized to the model's weekly period (×7)
    const daily = roleWorkload(rrole({ department: 'support' }), supModel, { value: 8, period: 'day' })
    expect(daily.demandNormalized).toBeCloseTo(56, 6) // 8/day → 56/week
    expect(daily.status).toBe('overloaded')            // 56 > 40
    expect(daily.backlog).toBeCloseTo(16, 6)
  })

  it('manual driver or missing demand → unknown, never a hire recommendation', () => {
    expect(roleWorkload(rrole({}), model({ capacityDriver: 'manual' }), { value: 999 }).status).toBe('unknown')
    expect(roleWorkload(rrole({}), model({ capacityDriver: 'manual' }), { value: 999 }).recommendation).toBeNull()
    const noData = roleWorkload(rrole({}), model({ capacityDriver: 'sales_opportunities' }), { value: null })
    expect(noData.status).toBe('unknown')
    expect(noData.demandAvailable).toBe(false)
    expect(roleWorkload(rrole({}), null, { value: 5 }).status).toBe('unknown')
  })

  it('zero capacity with positive demand → overloaded with full backlog', () => {
    const w = roleWorkload(rrole({ currentHeadcount: 0 }), model({}), { value: 50 })
    expect(w.status).toBe('overloaded')
    expect(w.backlog).toBe(50)
    expect(w.recommendation).not.toBeNull()
  })

  it('payroll uses component comp; reality and plan payroll never mix', () => {
    expect(costPerHeadCents(500000, 100000, 0.2)).toBe(700000)
    expect(realityPayrollCents(rrole({ currentHeadcount: 2, monthlySalaryCents: 500000, commissionCents: 100000, payrollBurdenPct: 0.2 }))).toBe(1400000)
    expect(planPayrollCents(hrole({ headcount: 3, monthlySalaryCents: 400000, commissionCents: 0, payrollBurdenPct: 0.25 }))).toBe(500000 * 3)
  })

  it('headcountView separates reality from plan; hired/cancelled excluded from planned', () => {
    const reality = [rrole({ currentHeadcount: 2 })]
    const plan = [hrole({ headcount: 1, status: 'proposed' }), hrole({ id: 'h2', headcount: 5, status: 'hired' }), hrole({ id: 'h3', headcount: 3, status: 'cancelled' })]
    const v = headcountView(reality, plan)
    expect(v.realityHeadcount).toBe(2)
    expect(v.plannedHeadcount).toBe(1)      // hired + cancelled excluded
    expect(v.projectedHeadcount).toBe(3)
    expect(v.realityPayrollCents).toBe(costPerHeadCents(600000, 0, 0.2) * 2)
  })

  it('normalizePeriod converts between day/week/month', () => {
    expect(normalizePeriod(1, 'day', 'week')).toBe(7)
    expect(normalizePeriod(30, 'month', 'day')).toBe(1)
    expect(capacityDistribution([roleWorkload(rrole({}), model({}), { value: 100 }), roleWorkload(rrole({}), model({ capacityDriver: 'manual' }), { value: 1 })])).toEqual({ under: 0, healthy: 0, near: 1, overloaded: 0, unknown: 1 })
  })
})

// ── Stores: versioning + audit + atomic move ───────────────────────────────────────────────────────────
function fakeSupportStore() {
  const rows = new Map<string, SupportOverlay>(); const changes: Array<{ before: unknown; after: unknown }> = []
  const d: SupportStoreDeps = {
    getAll: async () => [...rows.values()], get: async (id) => rows.get(id) ?? null,
    upsert: async (id, patch, actor, at) => { rows.set(id, { signalId: id, owner: null, issueType: null, severity: null, status: null, notes: null, resolutionNote: null, ...(rows.get(id) ?? {}), ...patch, updatedBy: actor, updatedAt: at } as SupportOverlay) },
    remove: async (id) => { rows.delete(id) }, addChange: async (_id, before, after) => { changes.push({ before, after }) },
  }
  return { d, rows, changes }
}
function fakeCapacityModelStore() {
  const rows = new Map<string, CapacityModel>(); const changes: Array<{ before: unknown; after: unknown }> = []; let n = 0
  const d: CapacityModelDeps = {
    getActive: async () => [...rows.values()].filter((r) => r.status === 'active'), get: async (id) => rows.get(id) ?? null,
    close: async (id, at) => { const r = rows.get(id); if (r) rows.set(id, { ...r, status: 'inactive', effectiveTo: at.slice(0, 10) }) },
    insert: async (m, actor, at) => { const id = `cm_${++n}`; const row = { ...m, id, updatedBy: actor, updatedAt: at } as CapacityModel; rows.set(id, row); return row },
    addChange: async (_id, before, after) => { changes.push({ before, after }) },
  }
  return { d, rows, changes }
}
function fakeTeamRealityStore() {
  const rows = new Map<string, TeamRealityRole>(); const changes: Array<{ before: unknown; after: unknown }> = []; let n = 0
  const d: TeamRealityDeps = {
    getActive: async () => [...rows.values()].filter((r) => r.status === 'active'), get: async (id) => rows.get(id) ?? null,
    close: async (id, at) => { const r = rows.get(id); if (r) rows.set(id, { ...r, status: 'inactive', effectiveTo: at.slice(0, 10) }) },
    insert: async (r, actor, at) => { const id = `tr_${++n}`; const row = { ...r, id, effectiveFrom: at.slice(0, 10), effectiveTo: null, status: 'active' as const, updatedBy: actor, updatedAt: at }; rows.set(id, row); return row },
    addChange: async (_id, before, after) => { changes.push({ before, after }) },
  }
  return { d, rows, changes }
}
function fakeHiringPlanStore() {
  const rows = new Map<string, HiringPlanRole>(); const changes: Array<{ before: unknown; after: unknown }> = []; const moves: string[] = []; let n = 0
  const d: HiringPlanDeps = {
    getAll: async () => [...rows.values()], get: async (id) => rows.get(id) ?? null,
    insert: async (patch, actor, at) => { const id = `hp_${++n}`; const row = { ...hrole({}), ...patch, id, updatedBy: actor, updatedAt: at } as HiringPlanRole; rows.set(id, row); return row },
    update: async (id, patch, actor, at) => { rows.set(id, { ...(rows.get(id) as HiringPlanRole), ...patch, updatedBy: actor, updatedAt: at }) },
    remove: async (id) => { rows.delete(id) }, addChange: async (_id, before, after) => { changes.push({ before, after }) },
    moveToReality: async (planId) => { const r = rows.get(planId)!; rows.set(planId, { ...r, status: 'hired' }); moves.push(planId); return 'new_reality_id' },
  }
  return { d, rows, changes, moves }
}

describe('Support overlay store — persistence & audit', () => {
  it('persists and audits before/after; clear removes and audits', async () => {
    const { d, rows, changes } = fakeSupportStore(); __setSupportStoreDepsForTests(d)
    await saveSupportOverlay('sig1', { owner: 'Yoad', severity: 'high', issueType: 'billing' }, 'founder')
    expect(rows.get('sig1')!.owner).toBe('Yoad')
    expect(changes[0].before).toMatchObject({ signalId: 'sig1', owner: null })
    expect(changes[0].after).toMatchObject({ owner: 'Yoad', severity: 'high' })
    await clearSupportOverlay('sig1', 'founder')
    expect(rows.has('sig1')).toBe(false)
    expect(changes[1].after).toBeNull()
  })
})

describe('Team stores — versioning, audit, atomic move', () => {
  it('capacity model edit versions (closes prior active, inserts new active) with audit', async () => {
    const { d, rows, changes } = fakeCapacityModelStore(); __setCapacityModelDepsForTests(d)
    rows.set('m0', model({ id: 'm0', capacityPerEmployee: 120 }))
    const updated = await saveCapacityModel('m0', { capacityPerEmployee: 150 }, 'founder')
    expect(rows.get('m0')!.status).toBe('inactive')      // prior closed, not overwritten
    expect(updated.capacityPerEmployee).toBe(150)
    expect(updated.status).toBe('active')
    expect(changes[0].before).toMatchObject({ capacityPerEmployee: 120 })
    expect(changes[0].after).toMatchObject({ capacityPerEmployee: 150 })
  })

  it('team reality edit versions the role and never overwrites history; close is soft', async () => {
    const { d, rows, changes } = fakeTeamRealityStore(); __setTeamRealityDepsForTests(d)
    rows.set('r0', rrole({ id: 'r0', currentHeadcount: 1 }))
    const v = await saveTeamRealityRole('r0', { currentHeadcount: 3 }, 'founder')
    expect(rows.get('r0')!.status).toBe('inactive')      // history preserved
    expect(v.currentHeadcount).toBe(3)
    expect(v.status).toBe('active')
    await closeTeamRealityRole(v.id, 'founder')
    expect(rows.get(v.id)!.status).toBe('inactive')
    expect(changes.length).toBe(2)
  })

  it('hiring plan create/update/delete audited; move-to-reality is explicit and marks the plan hired', async () => {
    const { d, rows, changes, moves } = fakeHiringPlanStore(); __setHiringPlanDepsForTests(d)
    const created = await saveHiringPlan(null, { department: 'support', role: 'Support Rep', headcount: 2, monthlySalaryCents: 500000 }, 'founder')
    expect(changes[0].before).toBeNull()
    const rid = await moveHireToReality(created.id, 'founder')
    expect(rid).toBe('new_reality_id')
    expect(rows.get(created.id)!.status).toBe('hired')   // plan preserved, marked hired
    expect(moves).toEqual([created.id])
    await deleteHiringPlan(created.id, 'founder')
    expect(rows.has(created.id)).toBe(false)
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
    expect(s.find((x) => x.id === 'c1')!.kind).toBe('human_takeover')
    expect(s.find((x) => x.id === 'c2')!.kind).toBe('open_conversation')
    expect(s.find((x) => x.id === 'c3')).toBeUndefined()
    expect(s.find((x) => x.id === 'c9')!.kind).toBe('message_failure')
    expect(s.find((x) => x.id === 'ch1')!.kind).toBe('channel_down')
    expect(s.find((x) => x.id === 'ch2')!.kind).toBe('channel_unverified')
  })
})
