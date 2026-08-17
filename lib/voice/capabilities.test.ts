import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  voiceCapabilities, encodeCapabilities, decodeCapabilities,
  ALL_VOICE_CAPABILITIES, VOICE_CAPABILITIES,
} from './capabilities'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const twiml = read('../../app/api/webhooks/twilio/voice/route.ts')
const server = read('../../voice-server/server.js')
const create = read('../appointments/create.ts')
const available = read('../../app/api/appointments/available/route.ts')

const T = (mods: string[] | null, tags: string[] = []) => ({ enabled_modules: mods, tags })

describe('what the phone AI may do', () => {
  it('mirrors the text pipeline: booking needs scheduling, catalog needs inventory', () => {
    expect(voiceCapabilities(T(['ai_voice', 'inbox', 'contacts']), null)).toEqual([])
    expect(voiceCapabilities(T(['scheduling']), null)).toEqual(['booking'])
    expect(voiceCapabilities(T(['inventory']), null)).toEqual(['catalog'])
    expect(voiceCapabilities(T(['payments']), null)).toEqual(['payments'])
    expect(voiceCapabilities(T(['scheduling', 'inventory', 'payments']), null)).toEqual(ALL_VOICE_CAPABILITIES)
  })

  it('honours the PLATFORM flag layer, not just the tenant toggle', () => {
    // A module switched off platform-wide must not stay live on the phone.
    expect(voiceCapabilities(T(['scheduling']), { scheduling: 'disabled' })).toEqual([])
    // Enterprise-gated and the tenant is not tagged.
    expect(voiceCapabilities(T(['inventory']), { inventory: 'enterprise' })).toEqual([])
    expect(voiceCapabilities(T(['inventory'], ['Enterprise']), { inventory: 'enterprise' })).toEqual(['catalog'])
  })

  it('a null column still means everything — a pre-migration tenant loses nothing', () => {
    expect(voiceCapabilities(T(null), null)).toEqual(ALL_VOICE_CAPABILITIES)
    expect(voiceCapabilities(null, null)).toEqual(ALL_VOICE_CAPABILITIES)
  })
})

describe('the wire contract survives either deploy order', () => {
  it('ABSENT means everything', () => {
    // voice-server deploys first → no parameter arrives → unchanged behaviour.
    expect(decodeCapabilities(undefined)).toEqual(ALL_VOICE_CAPABILITIES)
    expect(decodeCapabilities(null)).toEqual(ALL_VOICE_CAPABILITIES)
  })

  it('EMPTY means nothing — and the two must stay distinguishable', () => {
    // A tenant with all three modules off is a real state, not a missing parameter.
    expect(decodeCapabilities('')).toEqual([])
  })

  it('round-trips, and ignores anything it does not recognise', () => {
    expect(decodeCapabilities(encodeCapabilities(['booking', 'catalog']))).toEqual(['booking', 'catalog'])
    expect(decodeCapabilities('booking, nonsense ,catalog')).toEqual(['booking', 'catalog'])
  })

  it('carries CAPABILITIES, never module keys', () => {
    // voice-server must not learn the module vocabulary, or the two deployments drift on a rename.
    expect([...VOICE_CAPABILITIES]).toEqual(['booking', 'catalog', 'payments'])
    for (const k of ['scheduling', 'inventory']) {
      expect(VOICE_CAPABILITIES as readonly string[]).not.toContain(k)
    }
  })
})

describe('the app decides and passes it', () => {
  it('the TwiML emits the parameter', () => {
    expect(twiml).toContain('<Parameter name="capabilities" value="${escapeXml(capabilities)}"/>')
    expect(twiml).toContain('encodeCapabilities(voiceCapabilities(tenantRow, await getModuleFlags()))')
  })

  it('and fails SAFE — a flag read that throws passes everything', () => {
    // A phone AI that silently stops booking because an admin table hiccuped is worse than one that
    // books.
    expect(twiml).toContain("let capabilities = 'booking,catalog,payments'")
    expect(strip(twiml)).toMatch(/catch \(err\)[\s\S]{0,160}capability resolution failed/)
  })

  it('costs no extra query — the tenant row was already being read', () => {
    expect(twiml).toContain("select('owner_phone, phone, lead_intake_token, timezone, enabled_modules, tags')")
  })
})

describe('voice-server filters, it does not decide', () => {
  it('reads the parameter and keeps null distinct from empty', () => {
    expect(server).toContain('if (p.capabilities !== undefined) capabilities = p.capabilities;')
    expect(server).toContain('capabilities === null || capabilities === undefined')
  })

  it('offers only what it was allowed', () => {
    expect(server).toContain("check_availability: 'booking',")
    expect(server).toContain("book_appointment: 'booking',")
    expect(server).toContain("search_catalog: 'catalog',")
    expect(server).toContain("send_payment_link: 'payments',")
    expect(server).toContain('functions: gated,')
  })

  it('and transfer_to_human is untouched — a different fact, already working', () => {
    expect(server).toContain('if (transferNumber) {')
    expect(server).not.toMatch(/NEEDS\[[^\]]*\] = 'transfer/)
  })

  it('the KEYTERM list is gated on catalog too — it IS the catalog', () => {
    // The merge with feat/landed-cost-invoices put a second consumer of `capabilities` in this file:
    // keyterms, which sends the tenant's PRODUCT NAMES to Deepgram at call setup. It arrived
    // ungated, so a tenant whose catalog capability is off had its product list sent to a speech
    // vendor to sharpen transcription for a function the model is not even offered. Names only — no
    // prices, no stock — so not an exposure, but it contradicted the rule this gate exists to state.
    expect(server).toContain("if (!allows('catalog')) {")
    const fetchFn = server.slice(server.indexOf('async function fetchKeyterms'))
    expect(fetchFn.indexOf("allows('catalog')")).toBeLessThan(fetchFn.indexOf('await fetch('))
  })

  it('and both consumers read ONE definition of what a capability means', () => {
    // Two parses of the same comma-separated string is how the two drift apart.
    expect(server).toContain('function allows(capability) {')
    expect(server).toContain('allows(NEEDS[f.name])')
    // The old inline Set is gone rather than left beside its replacement.
    expect(server).not.toContain('new Set(capabilities.split')
  })
})

describe('the routes are the gate, not the tool list', () => {
  it('booking is refused in the SHARED core, so both doors are covered by one check', () => {
    // Neither /book nor /api/appointments checked this. A tenant with scheduling off got rows
    // written by phone and nothing objected.
    expect(create).toContain("if (!enabledModulesOf(tenant).includes('scheduling'))")
    expect(create).toContain("error: 'Booking is not enabled for this business.', status: 403")
  })

  it('availability refuses too, the way /api/catalog/lookup does', () => {
    expect(available).toContain("if (!enabledModulesOf(tenant).includes('scheduling'))")
    expect(read('../../app/api/catalog/lookup/route.ts')).toContain("includes('inventory')")
  })

  it('neither costs an extra query', () => {
    expect(create).toContain("select('id, business_name, phone, email, timezone, enabled_modules')")
    expect(available).toContain("select('id, timezone, enabled_modules')")
  })
})
