import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { stopDripsForPhone } from './drip'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const smsRoute = read('../../app/api/webhooks/twilio/sms/route.ts')
const waRoute = read('../../app/api/webhooks/twilio/whatsapp/route.ts')
const voiceRoute = read('../../app/api/conversations/voice/route.ts')
const drip = read('./drip.ts')

// A fake PostgREST chain. Every builder method returns `this`, and the terminal await resolves to
// whatever the test queued — enough to assert what the helper SELECTS, what it MATCHES, and what it
// UPDATES, which is the whole contract.
function fakeDb(rows: { id: string; contact_phone: string | null }[]) {
  const calls = { selectFilters: {} as Record<string, string>, updated: null as unknown, updatedIds: [] as string[], updateFilters: {} as Record<string, string> }
  let mode: 'select' | 'update' = 'select'
  const chain: Record<string, unknown> = {
    select() { mode = 'select'; return chain },
    update(patch: unknown) { mode = 'update'; calls.updated = patch; return chain },
    eq(col: string, val: string) { (mode === 'select' ? calls.selectFilters : calls.updateFilters)[col] = val; return chain },
    in(_col: string, ids: string[]) { calls.updatedIds = ids; return chain },
    then(resolve: (v: unknown) => void) {
      return Promise.resolve(mode === 'select' ? { data: rows, error: null } : { error: null }).then(resolve)
    },
  }
  return { db: { from: () => chain } as never, calls }
}

describe('answering ends the sequence', () => {
  it('matches on the last ten digits, not on the string', async () => {
    // THE POINT OF THE WHOLE FILE. `contact_phone` is whatever reached intakeLead: Twilio sends
    // E.164, a web form sends whatever it was typed as, and the live leads table already holds
    // '(917) 495-4300' and '9174954300'. An exact match looks fitted and never engages for those.
    const { db, calls } = fakeDb([
      { id: 'e164', contact_phone: '+19174954300' },
      { id: 'formatted', contact_phone: '(917) 495-4300' },
      { id: 'bare', contact_phone: '9174954300' },
      { id: 'other', contact_phone: '+19174639780' },
    ])
    const res = await stopDripsForPhone(db, 't1', '+19174954300', 'test')
    expect(res.stopped).toBe(3)
    expect(res.ids.sort()).toEqual(['bare', 'e164', 'formatted'])
    expect(res.ids).not.toContain('other')
  })

  it('stops ALL of that number’s campaigns, not the first', async () => {
    // Every lead starts its own campaign and nothing dedupes them — one number on the live table has
    // 21. Stopping one leaves the rest sending.
    const { db } = fakeDb(Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, contact_phone: '+19174954300' })))
    const res = await stopDripsForPhone(db, 't1', '9174954300', 'test')
    expect(res.stopped).toBe(21)
  })

  it('reads only this tenant’s ACTIVE campaigns, and writes scoped too', async () => {
    const { db, calls } = fakeDb([{ id: 'a', contact_phone: '+19174954300' }])
    await stopDripsForPhone(db, 'tenant-9', '+19174954300', 'test')
    expect(calls.selectFilters).toEqual({ tenant_id: 'tenant-9', status: 'active' })
    expect(calls.updateFilters.tenant_id).toBe('tenant-9')
    expect(calls.updatedIds).toEqual(['a'])
  })

  it('marks them stopped and nothing else — a reply is not a booking', async () => {
    const { db, calls } = fakeDb([{ id: 'a', contact_phone: '+19174954300' }])
    await stopDripsForPhone(db, 't1', '+19174954300', 'test')
    expect(calls.updated).toMatchObject({ status: 'stopped' })
    expect(calls.updated).toHaveProperty('updated_at')
    expect(JSON.stringify(calls.updated)).not.toMatch(/lead|booked|dismissed|next_send_at/)
  })

  it('never touches leads.status', () => {
    // The home screen still counts new+contacted as "not answered". Inventing a lead state here
    // would hide that rather than fix it — see item 3.
    expect(drip).not.toMatch(/from\('leads'\)/)
  })

  it('does nothing at all for an unusable number', async () => {
    const { db, calls } = fakeDb([{ id: 'a', contact_phone: '+19174954300' }])
    for (const bad of [null, undefined, '', 'unknown', '12345']) {
      const res = await stopDripsForPhone(db, 't1', bad, 'test')
      expect(res.stopped).toBe(0)
    }
    expect(calls.updatedIds).toEqual([])
  })

  it('swallows a failure rather than breaking the reply', async () => {
    const exploding = { from: () => { throw new Error('boom') } } as never
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(stopDripsForPhone(exploding, 't1', '+19174954300', 'test')).resolves.toEqual({ stopped: 0, ids: [] })
    spy.mockRestore()
  })
})

describe('it is wired where a customer actually answers', () => {
  it('an inbound SMS brakes BEFORE the claim and the pipeline', () => {
    // So it still fires when the AI errors or the send fails: a customer who wrote back must not be
    // chased either way.
    const brake = smsRoute.indexOf('await stopDripsForPhone')
    expect(brake).toBeGreaterThan(-1)
    expect(brake).toBeLessThan(smsRoute.indexOf('claimEvent('))
    expect(brake).toBeLessThan(smsRoute.indexOf('runAIPipeline('))
    // And after the channel lookup, which is where tenant_id comes from.
    expect(brake).toBeGreaterThan(smsRoute.indexOf("from('channels')"))
  })

  it('the reply still happens — the brake is a side effect, not a branch', () => {
    // Unconditional: the statement sits at the handler's own indent, not inside an `if`. (The STOP
    // rule that follows it IS a branch — a different rule, and one that runs after the brake.)
    const line = smsRoute.split('\n').find((l) => l.includes('await stopDripsForPhone'))!
    expect(line).toMatch(/^ {2}await stopDripsForPhone\(/)
    expect(smsRoute).toContain('runAIPipeline(')
  })

  it('STOP goes through the same helper and still silences the AI', () => {
    // It had the same exact-match blind spot. One brake, not two.
    expect(smsRoute).not.toMatch(/\.eq\('contact_phone'/)
    expect(smsRoute).toContain("if ((Body || '').trim().toLowerCase() === 'stop')")
    const stopBlock = smsRoute.slice(smsRoute.indexOf("=== 'stop'"))
    expect(stopBlock.slice(0, 220)).toContain('return emptyTwiml()')
  })

  it('a WhatsApp reply brakes on the un-prefixed number', () => {
    expect(waRoute).toContain('await stopDripsForPhone(supabase, channel.tenant_id, fromNumber')
  })

  it('an answered call brakes, and only behind the transcript gate', () => {
    expect(voiceRoute).toContain("await stopDripsForPhone(supabase, tenantId, phone, 'answered call')")
    // The route returns early on an empty transcript, so a ring-out that never spoke cancels nothing.
    expect(voiceRoute.indexOf("skipped: 'empty_transcript'")).toBeLessThan(voiceRoute.indexOf('stopDripsForPhone(supabase'))
  })

  it('a delivery receipt is not a reply', () => {
    const status = read('../../app/api/webhooks/twilio/sms-status/route.ts')
    expect(status).not.toContain('stopDripsForPhone')
  })

  it('the ring-out webhook does not brake — nobody has spoken yet', () => {
    expect(read('../../app/api/webhooks/twilio/voice/route.ts')).not.toContain('stopDripsForPhone')
  })
})
