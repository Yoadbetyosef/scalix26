import { describe, it, expect, afterEach, vi } from 'vitest'
import { countActiveClients, __setClientCountDepsForTests, type ClientCountDeps } from './platform-clients'

afterEach(() => __setClientCountDepsForTests(null))

function deps(tenants: Array<{ id: string; suspended_at: string | null }>, activeIds: string[]): ClientCountDeps {
  const d: ClientCountDeps = {
    loadPartnerTenants: vi.fn(async () => tenants),
    loadActiveClientTenantIds: vi.fn(async () => activeIds),
  }
  __setClientCountDepsForTests(d)
  return d
}

describe('countActiveClients', () => {
  it('counts only tenants that exist, are unsuspended, and have an active client row', async () => {
    deps(
      [{ id: 't1', suspended_at: null }, { id: 't2', suspended_at: null }, { id: 't3', suspended_at: null }],
      ['t1', 't2'],
    )
    expect(await countActiveClients('p1')).toEqual({ activeClients: 2, inactiveClients: 1, totalClients: 3 })
  })

  it('excludes a suspended tenant even if its client row is active', async () => {
    deps([{ id: 't1', suspended_at: '2026-01-01T00:00:00Z' }, { id: 't2', suspended_at: null }], ['t1', 't2'])
    expect(await countActiveClients('p1')).toMatchObject({ activeClients: 1, inactiveClients: 1 })
  })

  it('excludes a tenant with no active client row (paused/churned/prospect)', async () => {
    deps([{ id: 't1', suspended_at: null }, { id: 't2', suspended_at: null }], ['t1'])
    expect(await countActiveClients('p1')).toMatchObject({ activeClients: 1, inactiveClients: 1, totalClients: 2 })
  })

  it('is zero for a partner with no tenants', async () => {
    deps([], [])
    expect(await countActiveClients('p1')).toEqual({ activeClients: 0, inactiveClients: 0, totalClients: 0 })
  })

  it('ignores active client ids that point to a non-existent (deleted) tenant', async () => {
    // t2 was hard-deleted → not in tenants → not counted, even though it appears active in partner_clients.
    deps([{ id: 't1', suspended_at: null }], ['t1', 't2'])
    expect(await countActiveClients('p1')).toEqual({ activeClients: 1, inactiveClients: 0, totalClients: 1 })
  })
})
