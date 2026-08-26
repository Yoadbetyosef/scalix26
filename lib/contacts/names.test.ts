import { describe, it, expect } from 'vitest'
import { contactDisplayName, contactDisplayOrIdentifier, contactInitial, isBusinessContact, personName } from './names'
import { autoMapHeaders, CONTACT_FIELDS } from './csv'

// WHAT A B2B CONTACT IS CALLED, and what happens to everybody who is not one.
describe('contact display names', () => {
  it('leads with the company and follows with the person', () => {
    expect(contactDisplayName({ company_name: 'M&P Yacht Centre', name: 'Irina Gavala' }))
      .toBe('M&P Yacht Centre — Irina Gavala')
  })

  it('shows whichever one exists when only one does', () => {
    // A business with nobody named yet is a real customer — TG's book already contains one.
    expect(contactDisplayName({ company_name: 'M&P Yacht Centre' })).toBe('M&P Yacht Centre')
    expect(contactDisplayName({ name: 'Irina Gavala' })).toBe('Irina Gavala')
  })

  it('composes the person from the two parts when there is no single name', () => {
    expect(contactDisplayName({ first_name: 'Irina', last_name: 'Gavala' })).toBe('Irina Gavala')
    expect(contactDisplayName({ company_name: 'M&P', first_name: 'Irina' })).toBe('M&P — Irina')
  })

  it('changes nothing for a contact that has neither — the old ladder, exactly', () => {
    // ~40% of TG's book arrived from a call with nothing but a number. Those rows must render today
    // exactly as they did before companies existed.
    expect(contactDisplayOrIdentifier({ name: 'Artin' })).toBe('Artin')
    expect(contactDisplayOrIdentifier({ email: 'a@b.co' })).toBe('a@b.co')
    expect(contactDisplayOrIdentifier({ phone: '+16045551234' })).toBe('+16045551234')
    expect(contactDisplayOrIdentifier({})).toBe('Unknown')
    // The ladder is ordered: a name beats an email beats a phone.
    expect(contactDisplayOrIdentifier({ name: 'Artin', email: 'a@b.co', phone: '+1' })).toBe('Artin')
  })

  it('takes the avatar letter from whatever leads', () => {
    expect(contactInitial({ company_name: 'M&P Yacht Centre', name: 'Irina Gavala' })).toBe('M')
    expect(contactInitial({ name: 'Irina Gavala' })).toBe('I')
    expect(contactInitial({ phone: '+1604' })).toBe('+')
  })

  it('knows a business from a private customer', () => {
    expect(isBusinessContact({ company_name: 'M&P' })).toBe(true)
    expect(isBusinessContact({ company_name: '   ' })).toBe(false)
    expect(isBusinessContact({ name: 'Irina Gavala' })).toBe(false)
  })

  it('derives the person from two parts, and gives null rather than an empty string', () => {
    expect(personName('Irina', 'Gavala')).toBe('Irina Gavala')
    expect(personName('Irina', null)).toBe('Irina')
    expect(personName(null, 'Gavala')).toBe('Gavala')
    // null, not '' — the store writes this straight into `name`, and '' would blank a real name.
    expect(personName(null, null)).toBeNull()
    expect(personName('  ', '  ')).toBeNull()
  })
})

describe('the importer stopped dropping surnames', () => {
  it('maps First Name and Last Name to their own fields', () => {
    // THE BUG: 'first name' was an alias for the single `name` column, so a spreadsheet with First
    // Name and Last Name — what a B2B address book exports — imported the forename and threw every
    // surname in the file away without saying so.
    expect(autoMapHeaders(['First Name', 'Last Name'])).toEqual(['first_name', 'last_name'])
  })

  it('recognises a company column under the spellings a real export uses', () => {
    expect(autoMapHeaders(['Company'])).toEqual(['company_name'])
    expect(autoMapHeaders(['Business Name'])).toEqual(['company_name'])
    expect(autoMapHeaders(['Organisation'])).toEqual(['company_name'])
  })

  it('still maps a single Name column, and prefers the parts when a file has both', () => {
    expect(autoMapHeaders(['Name'])).toEqual(['name'])
    // Declared before `name`, so a file carrying both fills the parts rather than the whole.
    expect(autoMapHeaders(['First Name', 'Last Name', 'Name'])).toEqual(['first_name', 'last_name', 'name'])
  })

  it('offers the three new columns for hand-mapping too', () => {
    const keys = CONTACT_FIELDS.map((f) => f.key)
    for (const k of ['company_name', 'first_name', 'last_name']) expect(keys).toContain(k)
  })
})
