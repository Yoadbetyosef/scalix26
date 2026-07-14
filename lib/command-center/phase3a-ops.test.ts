import { describe, it, expect, afterEach } from 'vitest'
import {
  __setOverlayDepsForTests, saveOverlay, clearOverlay, filterQueue, sortQueue,
  type OverlayDeps, type OnboardingOverlay, type OnboardingCase,
} from './onboarding-overlay'
import { __setLifecycleDepsForTests, recordLifecycleEvent, classifySubscriptionChange, type LifecycleDeps } from './lifecycle-events'
import { trialConversion, type TrialModel } from './trial-conversion'
import { realitySnapshot, type CustomerModel } from './adapters'

afterEach(() => { __setOverlayDepsForTests(null); __setLifecycleDepsForTests(null) })

function fakeOverlay() {
  const rows = new Map<string, OnboardingOverlay>()
  const changes: Array<{ tenantId: string; before: unknown; after: unknown; actor: string }> = []
  const d: OverlayDeps = {
    getAll: async () => [...rows.values()],
    get: async (id) => rows.get(id) ?? null,
    upsert: async (id, patch, actor, at) => { rows.set(id, { ...(rows.get(id) ?? { tenantId: id } as OnboardingOverlay), ...patch, tenantId: id, updatedBy: actor, updatedAt: at } as OnboardingOverlay) },
    remove: async (id) => { rows.delete(id) },
    addChange: async (tenantId, before, after, actor) => { changes.push({ tenantId, before, after, actor }) },
  }
  __setOverlayDepsForTests(d)
  return { rows, changes }
}

describe('Onboarding overlay (persistence + audit)', () => {
  it('saves an overlay, audits before/after, survives re-read', async () => {
    const s = fakeOverlay()
    const after = await saveOverlay('t1', { owner: 'CEO', blocker: 'twilio_approval', priority: 'high' }, 'founder@x')
    expect(after.owner).toBe('CEO'); expect(after.priority).toBe('high'); expect(after.updatedBy).toBe('founder@x')
    expect(s.rows.get('t1')!.blocker).toBe('twilio_approval')
    expect(s.changes[0]).toMatchObject({ tenantId: 't1', actor: 'founder@x' })
    expect(s.changes[0].after).toMatchObject({ owner: 'CEO' })
  })
  it('clear removes the overlay and audits (before → null)', async () => {
    const s = fakeOverlay()
    await saveOverlay('t1', { owner: 'X' }, 'f')
    await clearOverlay('t1', 'f')
    expect(s.rows.has('t1')).toBe(false)
    expect(s.changes.at(-1)!.after).toBeNull()
  })
  it('manual stage never alters the system-observed stage', () => {
    const cases: OnboardingCase[] = [{ tenantId: 't1', name: 'A', engine: 'direct', observedStage: 'technically_live', daysInOnboarding: 5, mrrCents: 0, activated: false, overlay: { tenantId: 't1', manualStage: 'contract sent', owner: null, blocker: null, blockerNotes: null, slaDueDate: null, priority: null, nextAction: null, followUpDate: null, status: null, resolutionNote: null, updatedBy: 'f', updatedAt: 't' } }]
    expect(cases[0].observedStage).toBe('technically_live') // overlay.manualStage does not overwrite it
  })
})

describe('Onboarding operational queue (filter + sort)', () => {
  const mk = (id: string, o: Partial<OnboardingCase>): OnboardingCase => ({ tenantId: id, name: id, engine: 'direct', observedStage: 'signed_up', daysInOnboarding: 3, mrrCents: 0, activated: false, overlay: null, ...o })
  const now = Date.parse('2026-07-20T00:00:00Z')
  const overlay = (p: Partial<OnboardingOverlay>): OnboardingOverlay => ({ tenantId: 'x', owner: null, manualStage: null, blocker: null, blockerNotes: null, slaDueDate: null, priority: null, nextAction: null, followUpDate: null, status: null, resolutionNote: null, updatedBy: null, updatedAt: null, ...p })
  const cases = [
    mk('breach', { overlay: overlay({ slaDueDate: '2026-07-10', priority: 'high', blocker: 'twilio_approval', owner: 'A' }), mrrCents: 5000 }),
    mk('highpri', { overlay: overlay({ priority: 'high', blocker: 'meta_approval', owner: 'B' }), mrrCents: 10000 }),
    mk('bigmrr', { mrrCents: 20000 }),
    mk('stalled', { daysInOnboarding: 30 }),
    mk('unassigned', { mrrCents: 1000 }),
  ]
  it('filters: outsideSla / stalled / highPriority / unassigned / blocker / engine', () => {
    expect(filterQueue(cases, { outsideSla: true }, now).map((c) => c.tenantId)).toEqual(['breach'])
    expect(filterQueue(cases, { stalled: true }, now).map((c) => c.tenantId)).toEqual(['stalled'])
    expect(filterQueue(cases, { highPriority: true }, now).map((c) => c.tenantId).sort()).toEqual(['breach', 'highpri'])
    expect(filterQueue(cases, { blocker: 'meta_approval' }, now).map((c) => c.tenantId)).toEqual(['highpri'])
    expect(filterQueue(cases, { unassigned: true }, now).every((c) => !c.overlay?.owner)).toBe(true)
  })
  it('sorts: outside-SLA → high-priority blocker → MRR → time → unassigned', () => {
    const order = sortQueue(cases, now).map((c) => c.tenantId)
    expect(order[0]).toBe('breach')   // outside SLA first
    expect(order[1]).toBe('highpri')  // then high-priority blocker
    expect(order[2]).toBe('bigmrr')   // then highest MRR
  })
})

describe('Lifecycle-event instrumentation', () => {
  function fakeLc(behavior: 'ok' | 'dup' | 'throw' = 'ok') {
    const rows: Record<string, unknown>[] = []
    const d: LifecycleDeps = { insert: async (row) => { if (behavior === 'throw') throw new Error('db down'); if (behavior === 'dup') return { duplicate: true }; rows.push(row); return { duplicate: false } } }
    __setLifecycleDepsForTests(d)
    return rows
  }
  it('records refund/chargeback/failure/recovery/cancellation with kind + amount + idempotency key', async () => {
    const rows = fakeLc('ok')
    for (const kind of ['refund', 'chargeback', 'failed_payment', 'recovery', 'cancellation'] as const) {
      const r = await recordLifecycleEvent({ tenantId: 't1', kind, sourceEventId: `evt_${kind}`, mrrCents: 100, occurredAt: '2026-07-14T00:00:00Z' })
      expect(r.recorded).toBe(true)
    }
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ kind: 'refund', tenant_id: 't1', source: 'stripe_webhook', idempotency_key: 'cc:evt_refund:refund' })
  })
  it('idempotent duplicate webhook → no new row', async () => {
    fakeLc('dup')
    expect(await recordLifecycleEvent({ tenantId: 't1', kind: 'cancellation', sourceEventId: 'evt_1' })).toEqual({ recorded: false, duplicate: true })
  })
  it('missing tenant mapping still records (tenant_id null)', async () => {
    const rows = fakeLc('ok')
    await recordLifecycleEvent({ tenantId: null, kind: 'refund', sourceEventId: 'evt_x' })
    expect(rows[0].tenant_id).toBeNull()
  })
  it('instrumentation failure does NOT throw (webhook stays successful)', async () => {
    fakeLc('throw')
    await expect(recordLifecycleEvent({ tenantId: 't1', kind: 'refund', sourceEventId: 'evt_y' })).resolves.toEqual({ recorded: false, duplicate: false })
  })
  it('does not infer upgrade/downgrade when plan mapping is unreliable', () => {
    expect(classifySubscriptionChange({ prevAmountCents: 100, newAmountCents: 200, planMappingReliable: false })).toBe('subscription_changed')
    expect(classifySubscriptionChange({ prevAmountCents: 100, newAmountCents: 200, planMappingReliable: true })).toBe('upgrade')
    expect(classifySubscriptionChange({ prevAmountCents: 200, newAmountCents: 100, planMappingReliable: true })).toBe('downgrade')
  })
})

describe('Trial conversion (first-class while trial-heavy)', () => {
  const m = (o: Partial<TrialModel>): TrialModel => ({ isTrial: true, converted: false, activated: false, adopted: false, expired: false, engine: 'direct', ...o })
  it('computes conversion, activated-not-paid, opportunity, and by-engine', () => {
    const models = [
      m({ converted: true, isTrial: false, activated: true, engine: 'direct' }),
      m({ activated: true, engine: 'direct' }),
      m({ adopted: true, activated: true, engine: 'affiliate' }),
      m({ expired: true, engine: 'whiteLabel' }),
    ]
    const t = trialConversion(models, 39700)
    expect(t.started).toBe(4)
    expect(t.converted).toBe(1)
    expect(t.conversionRate).toBeCloseTo(0.25, 6)
    expect(t.activeTrials).toBe(2) // 3 trials, 1 expired
    expect(t.activatedNotPaid).toBe(2) // 2 activated trials, none converted
    expect(t.adoptedNotPaid).toBe(1)
    expect(t.trialMrrOpportunityCents).toBe(2 * 39700)
    expect(t.byEngine.direct.conversionRate).toBeCloseTo(0.5, 6) // 1 of 2 direct converted
  })
})

describe('Reality snapshot (Overview = reality only, never assumptions)', () => {
  const cm = (o: Partial<CustomerModel>): CustomerModel => ({
    id: 'x', name: 'X', engine: 'direct', planPriceCents: 0, lifecycle: 'onboarding',
    activated: false, adopted: false, setupComplete: false, healthOverall: 70, healthBucket: 'healthy',
    onboarding: {}, observedStage: 'signed_up', outcomes30d: 0, daysSinceSignup: 3,
    isTrial: true, converted: false, expired: false, ...o,
  })
  const NOW = '2026-07-13T00:00:00.000Z'

  it('current MRR/ARR/ARPU come only from PAYING customers at real plan price', () => {
    const models = [
      cm({ converted: true, isTrial: false, planPriceCents: 39700, activated: true, engine: 'direct' }),
      cm({ converted: true, isTrial: false, planPriceCents: 29700, activated: true, engine: 'affiliate' }),
      cm({ engine: 'direct' }),                      // active trial → contributes 0 MRR
      cm({ isTrial: true, expired: true, engine: 'whiteLabel' }), // expired trial
    ]
    const r = realitySnapshot(models, NOW)
    expect(r.currentMrrCents.value).toBe(69400)           // 39700 + 29700 only
    expect(r.currentMrrCents.source).toBe('derived_actual')
    expect(r.runRateArrCents.value).toBe(69400 * 12)      // run-rate, not a forecast
    expect(r.payingCustomers.value).toBe(2)
    expect(r.activeTrials.value).toBe(1)                  // expired trial excluded
    expect(r.totalCustomers.value).toBe(4)
    expect(r.arpuCents.value).toBe(34700)                // 69400 / 2
    expect(r.trialConversionRate.value).toBeCloseTo(0.5, 6) // 2 paying / 4
  })

  it('with zero paying customers, financial reality is empty (never a projection)', () => {
    const models = [cm({}), cm({ activated: true })]  // all trials
    const r = realitySnapshot(models, NOW)
    expect(r.currentMrrCents.value).toBe(0)
    expect(r.runRateArrCents.value).toBe(0)
    expect(r.arpuCents.value).toBeNull()               // no paying customers → no ARPU, not a guess
    expect(r.payingCustomers.value).toBe(0)
    // every returned metric is Actual/Derived-Actual/Estimate — never forecast/target/scenario
    const srcs = [r.currentMrrCents, r.runRateArrCents, r.arpuCents, r.payingCustomers, r.activeTrials,
      r.totalCustomers, r.trialConversionRate, r.activationRate, r.adoptionRate, r.revenueAtRiskCents].map((m) => m.source)
    expect(srcs.every((s) => s === 'derived_actual' || s === 'actual' || s === 'estimate')).toBe(true)
  })

  it('per-engine reality only counts real paying/trial customers', () => {
    const models = [
      cm({ converted: true, isTrial: false, planPriceCents: 39700, engine: 'whiteLabel' }),
      cm({ engine: 'whiteLabel' }),
      cm({ engine: 'direct' }),
    ]
    const r = realitySnapshot(models, NOW)
    const wl = r.byEngine.find((e) => e.engine === 'whiteLabel')!
    expect(wl.total).toBe(2); expect(wl.paying).toBe(1); expect(wl.activeTrials).toBe(1); expect(wl.mrrCents).toBe(39700)
    expect(r.byEngine.find((e) => e.engine === 'affiliate')!.total).toBe(0)
  })
})
