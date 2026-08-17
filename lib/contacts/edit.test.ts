import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { looksLikeName } from '@/lib/utils'
import { CONTACT_FIELDS, contactFieldsSchema } from './schema'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const store = read('./store.ts')
const route = read('../../app/api/contacts/[id]/route.ts')
const create = read('../../app/api/contacts/route.ts')
const aiName = read('./ai-name.ts')
// The /v2 sheet is not on this branch; its assertions came out with it. The v1 form's own
// block is at the bottom, and it asserts the same rules against the same route.
const voice = strip(read('../../app/api/conversations/voice/route.ts'))
const book = strip(read('../../app/api/appointments/book/route.ts'))
const stl = strip(read('../leads/speed-to-lead.ts'))

describe('a name is a name, at every door', () => {
  it('rejects the two the live table holds that it always claimed to reject', () => {
    expect(looksLikeName("Yes. It's your aunt.")).toBe(false)   // 4 words
    expect(looksLikeName('What?')).toBe(false)                  // '?'
  })

  it('and now rejects the one that used to pass', () => {
    // A full stop after a whole word ends a sentence. "Your aunt." was accepted by every rule the
    // filter had, and is sitting in the contacts table because of it.
    expect(looksLikeName('Your aunt.')).toBe(false)
    expect(looksLikeName('my brother')).toBe(false)
    expect(looksLikeName('it is me')).toBe(false)
    expect(looksLikeName('Hello there')).toBe(false)
  })

  it('without rejecting people', () => {
    for (const n of ['Sarah', 'Yoad Bet yosef', 'Mary-Jane O’Neill', 'J. Smith', 'Dr. Patel',
                     'Martin Jr.', 'José García', 'An', 'May Chen', 'Will Smith', 'Rose']) {
      expect(looksLikeName(n), n).toBe(true)
    }
  })

  it('all three automated writers go through the one helper', () => {
    // The filter used to be at ONE of three call sites, which is why two names it rejects are in the
    // table. A rule applied at one of three places is a coincidence, not a rule.
    for (const src of [voice, book, stl]) {
      expect(src).toContain('writeCapturedName')
      expect(src).not.toMatch(/update\(\{ name \}\)/)
    }
  })

  it('and the INSERT doors apply the same test', () => {
    // An update guard cannot help a path that creates the row. Two of the four got in that way.
    expect(book).toContain('looksLikeCapturedName(name) ? name : null')
    expect(stl).toContain('looksLikeCapturedName(name) ? name : null')
  })

  it('the helper guards on the decision as well as on the gap', () => {
    expect(aiName).toContain(".is('name', null)")
    expect(aiName).toMatch(/\.not\('manual_fields', 'cs', `\{\$\{NAME_FIELD\}\}`\)/)
  })

  it('and never throws into a webhook', () => {
    expect(aiName).toContain("return 'failed'")
    expect(aiName).toContain('catch (err)')
  })
})

describe('editing a contact', () => {
  it('writes the same six fields create does, from one schema', () => {
    expect([...CONTACT_FIELDS]).toEqual(['name', 'email', 'phone', 'address', 'currency', 'notes'])
    expect(create).toContain('const schema = contactFieldsSchema')
    expect(route).toContain('contactFieldsSchema.safeParse')
    // Not channel/language/total_conversations — derived or dead, and a form offering them invites
    // the owner to fight the system.
    for (const f of ['channel', 'language', 'total_conversations', 'last_interaction']) {
      expect(CONTACT_FIELDS as readonly string[]).not.toContain(f)
    }
  })

  it('keeps create’s validation exactly', () => {
    expect(contactFieldsSchema.safeParse({ email: 'nope' }).success).toBe(false)
    expect(contactFieldsSchema.safeParse({ email: '' }).success).toBe(true)
    expect(contactFieldsSchema.safeParse({ name: 'x'.repeat(301) }).success).toBe(false)
  })

  it('absent is untouched; present-and-blank is CLEARED', () => {
    // The distinction is the whole reason manual_fields exists.
    expect(store).toContain('const touched = CONTACT_FIELDS.filter((f) => f in patch)')
    expect(store).toContain("next[f] = ((patch[f] ?? '') as string).trim() || null")
  })

  it('records every field a person touched, set or cleared, without undoing earlier ones', () => {
    expect(store).toContain('manual_fields: [...new Set([...priorManual, ...touched])]')
  })

  it('cannot leave a contact with no way to identify them', () => {
    // Checked against the MERGED row, not the patch.
    expect(store).toContain('if (!merged.name && !merged.email && !merged.phone)')
  })

  it('refuses a collision with 409 and the record it clashed with', () => {
    // The same contract as create, so the UI has ONE shape for "already in your book". When merge
    // lands from scalix-core-platform-foundation, this 409 is where it gets offered.
    expect(store).toContain("const others = (await loadExisting(c.tenantId)).filter((r) => r.id !== id)")
    expect(store).toContain('duplicateOf: dupe')
    expect(route).toContain('status: r.duplicateOf ? 409 : 400')
    expect(create).toContain('status: r.duplicateOf ? 409 : 400')
  })

  it('stamps updated_at itself — there is no trigger on this table', () => {
    expect(store).toContain('updated_at: new Date().toISOString()')
  })

  it('does not write normalized_phone/email — OUTSTANDING §24', () => {
    // A third writer to columns nothing reads would deepen the illusion that they are a mechanism.
    const edit = store.slice(store.indexOf('export async function updateContact'))
    expect(edit).not.toContain('normalized_email:')
    expect(edit).not.toContain('normalized_phone:')
  })

  it('is tenant-scoped on read AND write', () => {
    const edit = store.slice(store.indexOf('export async function updateContact'))
    expect((edit.match(/\.eq\('tenant_id', c\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('the v1 form', () => {
  const form = read('../../components/contacts/contact-edit.tsx')
  const page = read('../../app/contacts/[id]/page.tsx')

  it('shows EVERY field, whether or not it has a value', () => {
    // The detail screen renders each field conditionally, which is right for reading and is exactly
    // why nothing looked editable: a missing field rendered nothing, so there was no empty box to
    // click and no way to learn the field existed.
    for (const f of ['name', 'email', 'phone', 'address', 'currency', 'notes']) {
      expect(form, f).toContain(`key: '${f}'`)
    }
  })

  it('and they are the schema’s six, not a second list', () => {
    const declared = Object.keys(contactFieldsSchema.shape)
    expect([...form.matchAll(/key: '(\w+)'/g)].map((m) => m[1]).sort()).toEqual(declared.sort())
  })

  it('sends only what changed', () => {
    // Sending all six would mark every field decided the first time somebody fixed a typo — the
    // whole-row freeze the per-field column exists to avoid.
    expect(form).toContain('if (now !== was) patch[x.key] = now || null')
    expect(form).toContain('if (!Object.keys(patch).length)')
  })

  it('a 409 names WHO the number already belongs to', () => {
    expect(form).toContain('if (res.status === 409 && j.duplicateOf) { setDupe(j.duplicateOf); return }')
  })

  it('the notes card is always there, empty or not', () => {
    expect(page).not.toMatch(/\{contact\.notes && \(/)
    expect(page).toContain('No notes yet. Use Edit above to add some.')
  })

  it('the route has no /v2 gate on this branch', () => {
    // The preview does not exist here; v1's form is the only caller and
    // requireActiveBusinessContext is the real gate.
    expect(strip(route)).not.toContain('v2Allowed')
  })
})
