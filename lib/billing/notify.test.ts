import { describe, it, expect, afterEach, vi } from 'vitest'
import { desiredNotice, syncBalanceNotice, __setNoticeDepsForTests, type NoticeWallet, type NoticeDeps, type NoticeState } from './notify'

afterEach(() => __setNoticeDepsForTests(null))

function wallet(over: Partial<NoticeWallet> = {}): NoticeWallet {
  return { balance_cents: 100000, low_balance_threshold_cents: 10000, status: 'active', balance_notice_state: 'none', currency: 'usd', ...over }
}

function deps(w: NoticeWallet) {
  const calls = { state: [] as NoticeState[], notifs: [] as string[], emails: [] as string[] }
  const d: NoticeDeps = {
    loadWallet: vi.fn(async () => w),
    setNoticeState: vi.fn(async (_p, s) => { calls.state.push(s) }),
    insertNotification: vi.fn(async (_p, n) => { calls.notifs.push(n.kind) }),
    emailPartner: vi.fn(async (_p, s) => { calls.emails.push(s) }),
  }
  __setNoticeDepsForTests(d)
  return { d, calls }
}

describe('desiredNotice (pure)', () => {
  it('none when comfortably funded', () => expect(desiredNotice(wallet())).toBe('none'))
  it('low when below threshold but positive', () => expect(desiredNotice(wallet({ balance_cents: 5000 }))).toBe('low'))
  it('paused when balance hits zero', () => expect(desiredNotice(wallet({ balance_cents: 0 }))).toBe('paused'))
  it('paused when status is paused even if balance looks positive', () =>
    expect(desiredNotice(wallet({ status: 'paused', balance_cents: 5000 }))).toBe('paused'))
  it('never low when threshold is unset', () => expect(desiredNotice(wallet({ balance_cents: 1, low_balance_threshold_cents: 0 }))).toBe('none'))
})

describe('syncBalanceNotice — fires once per crossing', () => {
  it('none → low: sets state, sends bell + email', async () => {
    const { calls } = deps(wallet({ balance_cents: 5000, balance_notice_state: 'none' }))
    expect(await syncBalanceNotice('p1')).toBe('low')
    expect(calls.state).toEqual(['low'])
    expect(calls.notifs).toEqual(['balance_low'])
    expect(calls.emails).toEqual(['low'])
  })
  it('low → paused: escalates with a pause notice', async () => {
    const { calls } = deps(wallet({ balance_cents: 0, balance_notice_state: 'low' }))
    expect(await syncBalanceNotice('p1')).toBe('paused')
    expect(calls.notifs).toEqual(['balance_paused'])
  })
  it('already low → still low: no duplicate notice (idempotent across ticks)', async () => {
    const { calls } = deps(wallet({ balance_cents: 5000, balance_notice_state: 'low' }))
    await syncBalanceNotice('p1')
    expect(calls.state).toEqual([])
    expect(calls.notifs).toEqual([])
  })
  it('recovery paused → none: updates state silently, no notification', async () => {
    const { calls } = deps(wallet({ balance_cents: 100000, balance_notice_state: 'paused' }))
    expect(await syncBalanceNotice('p1')).toBe('none')
    expect(calls.state).toEqual(['none'])
    expect(calls.notifs).toEqual([])
    expect(calls.emails).toEqual([])
  })
  it('email failure never breaks the sync', async () => {
    const w = wallet({ balance_cents: 0, balance_notice_state: 'none' })
    deps(w)
    __setNoticeDepsForTests({
      loadWallet: async () => w,
      setNoticeState: async () => {},
      insertNotification: async () => {},
      emailPartner: async () => { throw new Error('smtp down') },
    })
    expect(await syncBalanceNotice('p1')).toBe('paused')
  })
  it('no wallet row → null, no side effects', async () => {
    __setNoticeDepsForTests({
      loadWallet: async () => null,
      setNoticeState: vi.fn(async () => {}),
      insertNotification: vi.fn(async () => {}),
      emailPartner: vi.fn(async () => {}),
    })
    expect(await syncBalanceNotice('p1')).toBeNull()
  })
})
