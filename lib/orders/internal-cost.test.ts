import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { orderInternalCostCents } from './types'

// Internal cost must never reach a customer.
//
// The field exists so the business can see its own margin. A customer seeing what their ring cost to
// make is a commercial injury, not a cosmetic bug — so this asserts it structurally rather than
// trusting that nobody adds it to a template later.

/** Every surface a tenant's CUSTOMER can open. Keep in step with lib/documents/routes.ts. */
const CUSTOMER_SURFACES = [
  'app/orders/[id]/document/[type]/page.tsx',
  'app/d/[token]/page.tsx',
  'app/approval/[token]/page.tsx',
  'components/orders/public-approval.tsx',
  'app/api/studio/documents/[id]/send/route.ts',
]

describe('internal cost never reaches a customer surface', () => {
  it.each(CUSTOMER_SURFACES)('%s does not mention it', (file) => {
    const src = readFileSync(file, 'utf8')
    // Both spellings: the column and the camelCase field. A surface that renders either has leaked it.
    expect(src).not.toMatch(/internal_cost_cents/)
    expect(src).not.toMatch(/internalCostCents/)
  })

  it('the public approval projection carries no cost field at all', () => {
    // types.ts calls this projection "public-safe" — this is what makes that comment true rather than
    // aspirational.
    const src = readFileSync('lib/orders/types.ts', 'utf8')
    const projection = src.slice(src.indexOf('Public-safe projection'))
    expect(projection).not.toMatch(/internalCost/)
  })
})

describe('orderInternalCostCents — derived, never stored', () => {
  const line = (internalCostCents: number | null) => ({ internalCostCents })

  it('sums the lines that have a cost', () => {
    expect(orderInternalCostCents([line(1200), line(800), line(50)])).toBe(2050)
  })

  it('is NULL when nothing has been recorded, not 0', () => {
    // Unknown and free are different facts. Returning 0 here would report a 100% margin on every
    // order that predates the column.
    expect(orderInternalCostCents([line(null), line(null)])).toBeNull()
    expect(orderInternalCostCents([])).toBeNull()
  })

  it('sums what IS known when only some lines have a cost', () => {
    // The honest reading of a partial entry: report what is known rather than refusing to answer.
    expect(orderInternalCostCents([line(1200), line(null)])).toBe(1200)
  })

  it('treats a recorded 0 as a real figure', () => {
    expect(orderInternalCostCents([line(0)])).toBe(0)
    expect(orderInternalCostCents([line(0), line(500)])).toBe(500)
  })
})
