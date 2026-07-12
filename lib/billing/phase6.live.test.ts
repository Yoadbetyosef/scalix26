import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertPartnerActive, __setGateDepsForTests } from './gate'
import { syncBalanceNotice, __setNoticeDepsForTests } from './notify'

// LIVE integration proof against the real Supabase DB — runs the REAL gate + notice logic through
// deps backed by a service-role client (same queries as the production dbDeps, but via this client so
// next/headers is never loaded). Seeds two real test partners' balance rows + cleans them up.
// Skipped by default (so `npm test` never hits the network); run explicitly:
//   PHASE6_LIVE=1 npx vitest run lib/billing/phase6.live.test.ts
const LIVE = process.env.PHASE6_LIVE === '1'

const A = '91101ffb-9d52-41c0-a784-527e0d509b8e'          // Nature Sparkle (test partner)
const B = 'ec4f1a85-7d45-48bb-89f4-2d616cb2c363'          // Ella Scheflan (second partner — isolation)
const WL_TENANT_A = 'cb09d0a5-5fdc-4693-918a-5f0f10a576a6' // tenant owned by partner A
const DIRECT_TENANT = 'b45e6276-0998-4a95-a8cc-7d828304302e' // no white_label_partner_id

;(LIVE ? describe : describe.skip)('Phase 6 — live gate + notice (real DB)', () => {
  // PostgREST over fetch — avoids @supabase/supabase-js's realtime WebSocket (unsupported on Node 20).
  let BASE = '', H: Record<string, string> = {}
  const rest = (p: string) => fetch(`${BASE}/rest/v1/${p}`, { headers: H }).then((r) => r.json())
  const patch = (p: string, body: unknown) => fetch(`${BASE}/rest/v1/${p}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) })
  const post = (p: string, body: unknown, prefer = '') => fetch(`${BASE}/rest/v1/${p}`, { method: 'POST', headers: prefer ? { ...H, Prefer: prefer } : H, body: JSON.stringify(body) })
  const del = (p: string) => fetch(`${BASE}/rest/v1/${p}`, { method: 'DELETE', headers: H })
  const emailCount: Record<string, number> = {}

  beforeAll(() => {
    const env = Object.fromEntries(
      readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
    )
    BASE = env.NEXT_PUBLIC_SUPABASE_URL
    const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
    H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
    process.env.WL_BILLING_ENABLED = 'true'

    __setGateDepsForTests({
      async resolvePartner(tenantId) {
        const r = await rest(`tenants?select=white_label_partner_id&id=eq.${tenantId}`)
        return r[0]?.white_label_partner_id ?? null
      },
      async loadGateRow(partnerId) {
        const r = await rest(`partner_balances?select=status,balance_cents,pending_charge_cents,platform_fee_status&partner_id=eq.${partnerId}`)
        return r[0] || null
      },
    })
    __setNoticeDepsForTests({
      async loadWallet(partnerId) {
        const r = await rest(`partner_balances?select=balance_cents,low_balance_threshold_cents,status,balance_notice_state,currency&partner_id=eq.${partnerId}`)
        return r[0] || null
      },
      async setNoticeState(partnerId, state) { await patch(`partner_balances?partner_id=eq.${partnerId}`, { balance_notice_state: state }) },
      async insertNotification(partnerId, n) { await post('partner_notifications', { partner_id: partnerId, ...n }) },
      async emailPartner(partnerId) { emailCount[partnerId] = (emailCount[partnerId] || 0) + 1 },
    })
  })

  afterAll(async () => {
    __setGateDepsForTests(null); __setNoticeDepsForTests(null)
    if (!BASE) return
    await del(`partner_notifications?partner_id=in.(${A},${B})&kind=in.(balance_low,balance_paused)`)
    await del(`partner_balances?partner_id=in.(${A},${B})`)
  })

  const seed = async (partnerId: string, over: Record<string, unknown>) => {
    await post('partner_balances?on_conflict=partner_id',
      { partner_id: partnerId, balance_cents: 100000, pending_charge_cents: 0, low_balance_threshold_cents: 10000, status: 'active', platform_fee_status: 'active', balance_notice_state: 'none', currency: 'usd', ...over },
      'resolution=merge-duplicates,return=minimal')
  }
  const setBal = (partnerId: string, patchBody: Record<string, unknown>) => patch(`partner_balances?partner_id=eq.${partnerId}`, patchBody)
  const notifCount = async (partnerId: string, kind: string) => (await rest(`partner_notifications?select=id&partner_id=eq.${partnerId}&kind=eq.${kind}`)).length

  // ── GATE ──────────────────────────────────────────────────────────────────
  it('funded partner allowed', async () => {
    await seed(A, { balance_cents: 100000, status: 'active' })
    expect((await assertPartnerActive({ tenantId: WL_TENANT_A })).ok).toBe(true)
  })
  it('paused partner blocked (resolved via its WL tenant)', async () => {
    await seed(A, { status: 'paused' })
    const r = await assertPartnerActive({ tenantId: WL_TENANT_A })
    expect(r.ok).toBe(false); expect(r.reason).toBe('paused_balance')
  })
  it('depleted partner blocked', async () => {
    await seed(A, { balance_cents: 0, status: 'active' })
    expect((await assertPartnerActive({ partnerId: A })).reason).toBe('depleted')
  })
  it('platform past_due blocked', async () => {
    await seed(A, { balance_cents: 100000, status: 'active', platform_fee_status: 'past_due' })
    expect((await assertPartnerActive({ partnerId: A })).reason).toBe('platform_unpaid')
  })
  it('direct Scalix tenant unaffected', async () => {
    expect((await assertPartnerActive({ tenantId: DIRECT_TENANT })).ok).toBe(true)
  })
  it('cross-partner isolation: A paused, B funded → each reads its own wallet', async () => {
    await seed(A, { status: 'paused' }); await seed(B, { balance_cents: 100000, status: 'active' })
    expect((await assertPartnerActive({ partnerId: A })).ok).toBe(false)
    expect((await assertPartnerActive({ partnerId: B })).ok).toBe(true)
  })

  // ── NOTICE TRANSITIONS ──────────────────────────────────────────────────────
  it('normal → low: exactly one notification + one email; repeated ticks dedup', async () => {
    await seed(A, { balance_cents: 100000, status: 'active', balance_notice_state: 'none' })
    await del(`partner_notifications?partner_id=eq.${A}&kind=in.(balance_low,balance_paused)`)
    emailCount[A] = 0
    await setBal(A, { balance_cents: 5000 })
    expect(await syncBalanceNotice(A)).toBe('low')
    expect(await notifCount(A, 'balance_low')).toBe(1)
    expect(emailCount[A]).toBe(1)
    await syncBalanceNotice(A); await syncBalanceNotice(A)
    expect(await notifCount(A, 'balance_low')).toBe(1) // no duplicates across ticks
    expect(emailCount[A]).toBe(1)
  })
  it('low → paused: exactly one new paused notification; repeated paused ticks dedup', async () => {
    await setBal(A, { balance_cents: 0, status: 'paused' })
    expect(await syncBalanceNotice(A)).toBe('paused')
    expect(await notifCount(A, 'balance_paused')).toBe(1)
    await syncBalanceNotice(A)
    expect(await notifCount(A, 'balance_paused')).toBe(1)
  })
  it('funding restores active silently (no new notification)', async () => {
    const before = (await notifCount(A, 'balance_low')) + (await notifCount(A, 'balance_paused'))
    await setBal(A, { balance_cents: 100000, status: 'active' })
    expect(await syncBalanceNotice(A)).toBe('none')
    const after = (await notifCount(A, 'balance_low')) + (await notifCount(A, 'balance_paused'))
    expect(after).toBe(before)
  })
  it('a future new low crossing notifies again', async () => {
    await setBal(A, { balance_cents: 5000 })
    expect(await syncBalanceNotice(A)).toBe('low')
    expect(await notifCount(A, 'balance_low')).toBe(2) // re-armed after recovery
  })
})
