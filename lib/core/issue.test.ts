import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const docs = read('./documents.ts')
const route = read('../../app/api/core/documents/[type]/[id]/issue/route.ts')
const patchRoute = read('../../app/api/core/documents/[type]/[id]/route.ts')
const freeze = read('../../supabase/migrations/add_document_freeze.sql')

describe('issuing', () => {
  it('stamps a date and moves the status together, in ONE write', () => {
    // The literal moved into `stamp` when issuing also began snapshotting the due date and the
    // payment details. What matters is unchanged and is what this asserts: status, date and the
    // snapshot land in a single update, so a document can never be issued without its date.
    expect(docs).toContain("const stamp: Record<string, unknown> = { status: 'issued', issued_at: issuedAt, updated_at: issuedAt }")
    expect(docs).toContain('.update(stamp)')
    expect(docs.indexOf('stamp.due_on')).toBeLessThan(docs.indexOf('.update(stamp)'))
  })

  it('does NOT reallocate the number', () => {
    // createDocument already took it from numbering_counters, atomically, when the draft was made.
    // Re-allocating would renumber the four live invoices and break every reference to them.
    const fn = docs.slice(docs.indexOf('export async function issueDocument'), docs.indexOf('export async function updateStatus'))
    expect(fn).not.toContain('core_next_document_number')
    expect(fn).toContain("error: 'no_number'")
  })

  it('refuses a document with no lines, and allows a zero total', () => {
    // An invoice with nothing on it is not an invoice. A fully discounted one is a real thing, and
    // refusing it would be this file having an opinion about somebody else's business.
    expect(docs).toContain("if (!count) return { ok: false, error: 'no_lines' }")
    const fn = docs.slice(docs.indexOf('export async function issueDocument'), docs.indexOf('export async function updateStatus'))
    expect(fn).not.toMatch(/total_cents\s*<=?\s*0/)
  })

  it('cannot issue the same document twice, even from two requests at once', () => {
    // The status is in the WHERE clause, so the second update matches nothing.
    expect(docs).toContain(".eq('tenant_id', tenantId).eq('id', documentId).eq('status', 'draft')")
    expect(docs).toContain("if (!updated) return { ok: false, error: 'already_issued' }")
  })

  it('writes the transition to history', () => {
    expect(docs).toContain("from_status: 'draft', to_status: 'issued', actor")
  })

  it('is the ONE door — updateStatus refuses the word', () => {
    // Otherwise PATCH ?status=issued produces a document that says issued with no issued_at and
    // possibly no lines, which is the state issueDocument exists to prevent.
    expect(docs).toContain("if (toStatus === 'issued') return false")
    expect(patchRoute).toContain('updateStatus(c.tenantId, t, id, body.status')
  })

  it('answers each refusal in a sentence the screen can show', () => {
    expect(route).toContain("no_lines: 'Add a line before issuing it")
    expect(route).toContain("already_issued: 'That has already been issued.'")
    expect(route).toContain("r.error === 'already_issued' ? 409 : 400")
  })
})

describe('the freeze', () => {
  it('the code refuses a line on a non-draft', () => {
    expect(docs).toContain("if (head.status !== 'draft') return { ok: false, error: 'document_not_draft' }")
  })

  it('and so does the database, on insert AND update AND delete', () => {
    // Removing a line from an issued invoice changes its total exactly as adding one does.
    expect(freeze).toContain('BEFORE INSERT OR UPDATE OR DELETE ON sales_document_lines')
    expect(freeze).toContain("RAISE EXCEPTION 'document_not_draft'")
  })

  it('reads the parent’s status from the parent’s own table', () => {
    // A line can never be freer than its header.
    expect(freeze).toContain("WHEN 'invoice'  THEN 'invoices'")
    expect(freeze).toContain("EXECUTE format('SELECT status FROM %I WHERE id = $1 AND tenant_id = $2', v_table)")
  })

  it('leaves an unknown document family alone rather than blocking it', () => {
    expect(freeze).toContain('IF v_table IS NULL THEN RETURN v_row; END IF;')
  })

  it('has no override, deliberately', () => {
    // If an issued document is wrong the answer is a credit note, not editing history. Building an
    // escape now would make it the thing people reach for.
    // Comments stripped: the block above EXPLAINS why there is no override, and says the word.
    const sql = freeze.replace(/^--.*$/gm, ' ')
    expect(sql).not.toMatch(/force|override|bypass|skip_freeze/i)
  })
})
