import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { contactFieldsSchema, CONTACT_FIELDS } from './schema'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const store = read('./store.ts')
const form = read('../../components/contacts/new-contact.tsx')
const edit = read('../../components/contacts/contact-edit.tsx')

// ONE SPELLING FROM THE FORM TO THE COLUMN.
//
// The create path is: form posts its state object verbatim → the route runs contactFieldsSchema over
// it → createContact receives `parsed.data`. Every hop has to use the same key names, and for one
// commit the form and createContact used camelCase while the schema used snake_case. Nothing failed
// loudly: the schema dropped the unknown keys, createContact read undefined, and the contact saved
// with no company at all. TypeScript could not see it because every field is optional, so an object
// with the WRONG optional keys is still assignable to the right type.
describe('the contact write path speaks one language', () => {
  const b2b = ['company_name', 'first_name', 'last_name'] as const

  it('the schema validates the B2B fields under their column names', () => {
    for (const f of b2b) expect(contactFieldsSchema.shape as Record<string, unknown>).toHaveProperty(f)
    expect(contactFieldsSchema.safeParse({ company_name: 'M&P Yacht Centre' }).success).toBe(true)
  })

  it('createContact reads the SAME names the schema produces', () => {
    // The route passes parsed.data straight in, so a mismatch here is a silent data loss.
    for (const f of b2b) expect(store).toContain(`input.${f}`)
    // And nothing is left reading the camelCase spelling.
    for (const f of ['companyName', 'firstName', 'lastName']) expect(store).not.toContain(`input.${f}`)
  })

  it('and it writes them to the columns of those names', () => {
    expect(store).toContain('company_name: company || null')
    expect(store).toContain('first_name: first || null, last_name: last || null')
  })

  it('the new-contact form posts those names', () => {
    // It stringifies its state object whole, so the state keys ARE the payload keys.
    for (const f of b2b) expect(form).toContain(`${f}: ''`)
    expect(form).toContain('body: JSON.stringify(f)')
  })

  it('the edit form offers every field the shared list names', () => {
    // Both forms drive off CONTACT_FIELDS' meaning; edit enumerates them, so a field added to the
    // schema and not to the form is a field nobody can fill in.
    for (const f of b2b) expect(edit).toContain(`key: '${f}'`)
    expect(CONTACT_FIELDS as readonly string[]).toContain('company_name')
  })

  it('a company alone is enough to identify a contact', () => {
    // "M&P Yacht Centre" with a phone and nobody named is a real customer. The old guard read `name`
    // only and refused it.
    expect(store).toContain("if (!name && !company && !email && !phone)")
  })
})
