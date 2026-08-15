import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { reassignMapping } from '@/lib/contacts/csv'

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const actions = read('./actions.tsx')
const v1 = read('../../../../components/contacts/import-contacts.tsx')
const page = strip(read('./page.tsx'))
const list = read('../list.tsx')
const css = read('../v2-tokens.css')

describe('a reskin, not a rewrite', () => {
  it('calls the same two routes v1 calls', () => {
    expect(actions).toContain("fetch('/api/contacts'")
    expect(actions).toContain("fetch('/api/contacts/import'")
    expect(actions).toContain("mode: 'preview'")
    expect(actions).toContain("mode: 'commit'")
  })

  it('parses and maps through lib, deciding nothing itself', () => {
    // Every rule that classifies anything is in lib/contacts/csv.ts or on the server. If this file
    // ever grows one, the reskin has become a rewrite.
    expect(actions).toContain("from '@/lib/contacts/csv'")
    expect(actions).not.toMatch(/HEADER_ALIAS|looksLikeHeaderRow|normalizePhone|normalizeEmail/)
    expect(actions).not.toMatch(/detectDelimiter|parseDelimited/)
  })

  it('the one rule that lived in the v1 component now lives in lib, and both call it', () => {
    // "A field can only come from one column" was inline in the component. Copied into two
    // importers it would drift; moved verbatim it cannot.
    expect(v1).toContain('reassignMapping(mapping, col, field)')
    expect(actions).toContain('reassignMapping(mapping, col, field)')
    expect(v1).not.toMatch(/mapping\.map\(\(f, i\) => \(field/)
    expect(actions).not.toMatch(/mapping\.map\(\(f, i\) => \(field/)
  })

  it('and it still does what it did', () => {
    // Assigning a field to a new column takes it off the old one; everything else is untouched.
    expect(reassignMapping(['name', 'email', null], 2, 'name')).toEqual([null, 'email', 'name'])
    expect(reassignMapping(['name', 'email', null], 2, 'phone')).toEqual(['name', 'email', 'phone'])
    expect(reassignMapping(['name', 'email'], 0, null)).toEqual([null, 'email'])
  })

  it('keeps every step and every message the v1 flow had', () => {
    for (const rule of [
      'That file has no rows we could read',
      'CSV, TSV, or a tab-separated copy-paste from Excel',
      '.csv,.tsv,.txt,text/csv,text/plain',
      'Pick at least one column to import',
      'those rows are left alone, so nothing gets duplicated',
    ]) {
      expect(actions, rule).toContain(rule)
      expect(v1, rule).toContain(rule)
    }
  })

  it('nothing is written until the last click', () => {
    const commit = actions.slice(actions.indexOf('const commit ='))
    expect(commit.indexOf("mode: 'commit'")).toBeGreaterThan(-1)
    // The preview runs on load and on every mapping change; the commit only from its own button.
    expect((actions.match(/mode: 'commit'/g) ?? []).length).toBe(1)
  })
})

describe('the preview tells the whole truth', () => {
  it('shows all three outcomes, not just the good one', () => {
    // A preview that counts only what it will add is a progress bar. The other two are the reason
    // there are two passes at all.
    expect(actions).toContain('{preview.toCreate.length}')
    expect(actions).toContain('{preview.duplicates.length}')
    expect(actions).toContain('{preview.skipped.length}')
    expect(actions).toContain("can&apos;t be used")
  })

  it('and gives them equal weight on the screen', () => {
    expect(css).toContain('.v2 .v2-icounts { display: grid; grid-template-columns: repeat(3, 1fr)')
  })

  it('says WHY something was unusable rather than only how many', () => {
    expect(actions).toContain('{preview.skipped[0].reason}')
  })

  it('a column left out is greyed, not hidden', () => {
    expect(actions).toContain('data-off={mapping[ci] ? undefined : true}')
    expect(css).toContain('.v2 .v2-igrid td[data-off] { color: var(--v2-ink-24); }')
  })

  it('the grid scrolls inside its own box, never the page', () => {
    expect(css).toMatch(/\.v2 \.v2-igrid \{[^}]*overflow: auto/)
  })
})

describe('placement and treatment', () => {
  it('sits in the header, opposite the title', () => {
    expect(page).toContain('headerActions={<><ImportContacts /><NewContact /></>}')
    expect(list).toContain('{headerActions && <div className="v2-hacts">{headerActions}</div>}')
    expect(css).toContain('.v2 .v2-hacts { margin-left: auto;')
  })

  it('reaches ListPage as a NODE — the page is a server component', () => {
    expect(list).toContain('headerActions?: ReactNode')
  })

  it('New contact is the filled primary, Import the secondary with the glyph', () => {
    expect(actions).toContain('className="v2-hact" data-tone="primary" data-touch onClick={() => setOpen(true)}>New contact')
    expect(actions).toContain('<UploadGlyph />Import file')
    expect(css).toContain('.v2 .v2-hact[data-tone="primary"] { background: var(--v2-ink); border-color: var(--v2-ink); color: #fff; }')
  })

  it('both open the ONE sheet, not a second idiom', () => {
    expect(actions).toContain("from './sheet'")
    expect(actions).toContain('<Sheet title="New contact"')
    expect(actions).toContain('<Sheet title="Import contacts" wide')
    expect(actions).not.toContain('v2-eveil')
    expect(actions).not.toContain("e.key === 'Escape'")
  })

  it('the wide variant is a data attribute, not a second panel', () => {
    expect(css).toContain('.v2 .v2-epanel[data-wide] { width: min(720px, 100%); }')
  })

  it('New contact answers a 409 with the same sentence edit does', () => {
    expect(actions).toContain("duplicateMessage(j, 'That did not save.')")
  })
})
