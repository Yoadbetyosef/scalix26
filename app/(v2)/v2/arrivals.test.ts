import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { rudiLine } from './rudi-line'
import { waitingCount } from '@/lib/inbox/arrivals'

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
// Comments stripped: the block above these rules NAMES the wrong figures it replaced, and should.
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const data = strip(read('./data.ts'))
const arrivals = read('../../../lib/inbox/arrivals.ts')
const brief = read('../../../components/dashboard/hero/ask-amy-shared.ts')

const say = (i: Parameters<typeof rudiLine>[0]) => rudiLine(i).map((s) => s.text).join('')

describe('the opening line never calls a handled arrival unanswered', () => {
  it('says who arrived and that they were dealt with', () => {
    expect(say({ jobsToday: 0, newToday: 3, newHandled: 3, waiting: 0 }))
      .toBe('3 new people today — all handled. Nothing needs you right now.')
  })

  it('splits the two when only some were', () => {
    expect(say({ jobsToday: 0, newToday: 3, newHandled: 2, waiting: 1 }))
      .toBe('3 new people today, 2 handled. One thing needs you.')
  })

  it('does not claim any were handled when none were', () => {
    expect(say({ jobsToday: 0, newToday: 1, newHandled: 0, waiting: 1 }))
      .toBe('1 new person today. One thing needs you.')
  })

  it('still has a resting state, and reaches it with arrivals', () => {
    expect(say({ jobsToday: 0, newToday: 0, newHandled: 0, waiting: 0 }))
      .toBe('Quiet so far today. Nothing needs you right now.')
    // "Quiet" would be a lie on a day three people arrived and were dealt with.
    expect(say({ jobsToday: 0, newToday: 2, newHandled: 2, waiting: 0 })).not.toContain('Quiet')
  })

  it('keeps the jobs clause first and the conclusion accented', () => {
    const segs = rudiLine({ jobsToday: 2, newToday: 1, newHandled: 1, waiting: 0 })
    expect(segs[0].text).toBe('2 jobs on the books today. ')
    expect(segs.filter((s) => s.accent)).toHaveLength(1)
    expect(segs.at(-1)!.accent).toBe(true)
  })

  it('has no vocabulary for leads at all any more', () => {
    const src = read('./rudi-line.ts')
    expect(src).not.toMatch(/lead/i)
    expect(src).not.toMatch(/not been answered/)
  })
})

describe('every figure comes from the inbox’s own grouping', () => {
  it('waiting is the two groups the inbox puts in front of a person', () => {
    expect(waitingCount({ newToday: 9, newHandled: 9, drafts: 2, unanswered: 3 })).toBe(5)
  })

  it('arrivals reads the inbox rather than forming a second opinion', () => {
    // Two derivations of one value drift. The screen this describes must show the same rows.
    expect(arrivals).toContain("import { readMilesInbox } from '@/lib/miles/inbox-read'")
    expect(arrivals).not.toMatch(/from\('leads'\)/)
  })

  it('"new" is a first conversation, not a lead row', () => {
    // Twelve leads on the live table are four people. An owner means a person they have not dealt
    // with before.
    expect(arrivals).toContain(".lt('created_at', since)")
    expect(arrivals).toContain('firstTimers')
  })

  it('the day is the business’s, not the server’s', () => {
    expect(arrivals).toContain("new Intl.DateTimeFormat('en-CA', { timeZone: tz")
    expect(data).toContain('?.timezone ?? null')
  })
})

describe('nothing on the home screen reports handled work as outstanding', () => {
  it('Attention Needed carries the two inbox groups and nothing derived from lead status', () => {
    expect(data).toContain('arrivals.drafts > 0')
    expect(data).toContain('arrivals.unanswered > 0')
    expect(data).not.toContain('leads need an answer')
    expect(data).not.toContain('dash.stats.activeLeads')
  })

  it('the month-long takeover tally is gone from a list headed "needs you now"', () => {
    // It counted every handover this month, dealt with or not — and double-counted the ones whose
    // customer spoke last, which are already in `unanswered`.
    expect(data).not.toContain('humanTakeoverCount')
    expect(data).not.toContain('asked for a person')
  })

  it('the leads badge is gone rather than showing a number that was not true', () => {
    expect(data).toMatch(/leads: null,/)
  })

  it('the inbox badge counts the inbox', () => {
    // It read `totalConversations`, which counts Instagram and Facebook in the last 7 days and
    // nothing else — 0 on a tenant with 77 conversations, so the badge never appeared.
    expect(data).toContain('inbox: waiting || null')
    expect(data).not.toContain('dash.stats.totalConversations')
  })

  it('and the spoken brief says the same thing as the screen', () => {
    expect(data).toContain('waitingOnYou: waiting')
    expect(brief).toContain('`Waiting on you: ${b.waitingOnYou}`')
  })
})
