import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { AI_POLICY, OWNER_POLICY, MEETING_KINDS } from './create'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const core = read('./create.ts')
const notify = read('./notify.ts')
const aiRoute = read('../../app/api/appointments/book/route.ts')
const ownerRoute = read('../../app/api/appointments/route.ts')
const sheet = read('../../app/(v2)/v2/appointments/new.tsx')
const page = strip(read('../../app/(v2)/v2/appointments/page.tsx'))

describe('one insert, two policies', () => {
  it('there is exactly one place an appointment is written', () => {
    expect(core).toContain("from('appointments').insert({")
    expect(strip(aiRoute)).not.toContain("from('appointments').insert")
    expect(strip(ownerRoute)).not.toContain("from('appointments').insert")
    for (const r of [aiRoute, ownerRoute]) expect(r).toContain('createAppointment(')
  })

  it('the AI is held to the grid and the buffer; the owner is not', () => {
    // appointment_slots is what the business offers STRANGERS. On the live tenant it is empty
    // Wednesday through Saturday, and 28 of 33 tenants have no grid at all.
    expect(AI_POLICY).toMatchObject({ enforceSlotGrid: true, enforceLeadTime: true })
    expect(OWNER_POLICY).toMatchObject({ enforceSlotGrid: false, enforceLeadTime: false })
  })

  it('but BOTH refuse the past and BOTH refuse a double-booking', () => {
    // Not policy — a fact about time. The past guard sits outside the policy check.
    const past = core.slice(core.indexOf('if (dateIso < now.dateIso)'), core.indexOf('if (policy.enforceLeadTime'))
    expect(past).toContain("error: 'that date has already passed'")
    expect(past).not.toContain('policy.')
    expect(core).toContain(".neq('status', 'cancelled').maybeSingle()")
    expect(core).toContain("if (apptErr?.code === '23505') return { ok: false, error: 'that time was just taken' }")
  })

  it('an owner still cannot book earlier today than now', () => {
    expect(core).toContain("if (!policy.enforceLeadTime && dateIso === now.dateIso && slotMinutes(timeDb) < now.minutes)")
  })
})

describe('the contact is matched on digits, not on the string', () => {
  it('uses the rule every other writer already uses', () => {
    // .eq('phone', phone) is how +19174954300, (917) 495-4300 and 9174954300 became three contacts
    // for one person (OUTSTANDING §25). This changes the AI path too, deliberately.
    expect(core).toContain('const key = normalizePhone(input.phone)')
    expect(core).toContain('.find((c) => normalizePhone(c.phone) === key)')
    // Comments stripped: the note above it QUOTES the old exact match, and should.
    expect(strip(core)).not.toMatch(/\.eq\('phone', /)
  })

  it('and skips contacts already merged away', () => {
    expect(core).toContain(".is('merged_into_id', null)")
  })
})

describe('nothing is sent unless it should be', () => {
  it('the AI door tells both parties', () => {
    const call = aiRoute.slice(aiRoute.indexOf('await notifyBooking('))
    expect(call).toContain('customer: !suppressCustomerSms')
    expect(call).toContain('owner: true')
  })

  it('the owner door tells the owner NOTHING — they are the one who did it', () => {
    const call = ownerRoute.slice(ownerRoute.indexOf('await notifyBooking('))
    expect(call).toContain('owner: false')
    expect(call).toContain('customer: d.notify_customer === true')
  })

  it('the checkbox is off, and says exactly what would go out', () => {
    expect(sheet).toContain('const [tellThem, setTellThem] = useState(false)')
    expect(sheet).toContain('Text the customer a confirmation')
    expect(sheet).toContain('Sends “✅ Confirmed! Your appointment is on …” to')
  })

  it('a send failure can never unwrite the appointment', () => {
    expect(notify).toMatch(/catch \(err\)/)
    expect(notify).not.toContain('throw')
  })
})

describe('the owner route sits beside /book, not inside it', () => {
  it('is session-scoped and gated', () => {
    expect(ownerRoute).toContain('requireActiveBusinessContext()')
    expect(ownerRoute).toContain('v2Allowed(ctx.tenantId, user?.email)')
    expect(ownerRoute).not.toContain('lead_intake_token')
  })

  it('and /book still resolves its tenant only from the token', () => {
    // It is in PUBLIC_ROUTES: the token IS its security, and it must not gain a second credential.
    expect(aiRoute).toContain(".eq('lead_intake_token', leadToken)")
    expect(aiRoute).not.toContain('requireActiveBusinessContext')
  })

  it('the owner payload is validated, and the kind is an enum', () => {
    expect(ownerRoute).toContain("meeting_kind: z.enum(['on_site', 'zoom', 'google_meet', 'phone']).optional()")
    expect(MEETING_KINDS).toEqual(['on_site', 'zoom', 'google_meet', 'phone'])
  })

  it('a join_url that is not a link is dropped on BOTH doors', () => {
    for (const r of [aiRoute, ownerRoute]) expect(r).toMatch(/\/\^https\?:\\\/\\\/\\S\+\$\/i\.test\(joinRaw\)/)
  })
})

describe('the form', () => {
  it('opens the same sheet every other /v2 form opens', () => {
    expect(sheet).toContain("import { Sheet } from '../form-sheet'")
    expect(sheet).not.toContain('v2-eveil')
    expect(sheet).not.toContain("e.key === 'Escape'")
    // Four surfaces, one shell — contacts re-exports it so nothing there changed.
    expect(read('../../app/(v2)/v2/contacts/sheet.tsx')).toContain("export { Sheet } from '../form-sheet'")
  })

  it('picks an existing contact through the route that already exists', () => {
    expect(sheet).toContain('/api/contacts/search?q=')
  })

  it('offers the day’s free slots and still accepts any time typed', () => {
    expect(sheet).toContain('const free = (() => {')
    expect(sheet).toContain('<input type="time"')
    expect(sheet).toContain('Nothing set up for that day — type any time and it will book.')
  })

  it('needs a phone, because the column does', () => {
    expect(sheet).toContain('const ready = !!customerPhone.trim() && !!date && !!time')
    expect(ownerRoute).toContain('customer_phone: z.string().min(3).max(50),')
  })

  it('New is live, and the button is the form', () => {
    expect(page).toContain('<NewAppointment grid={grid} defaultMinutes=')
    expect(page).not.toContain('PREVIEW')
  })
})
