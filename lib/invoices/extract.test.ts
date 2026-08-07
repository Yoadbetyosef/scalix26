import { describe, it, expect } from 'vitest'
import { pageCountOf } from './extract'

// The page count is an OPTIMISATION — it exists to avoid paying to read a document too large to read.
// It broke the whole upload path once by throwing inside the critical path, so what these pin is mostly
// that it cannot do that again.

const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF`, 'latin1')

describe('counting pages without a PDF library', () => {
  it('counts page objects', () => {
    expect(pageCountOf(pdf('/Type /Page\n/Type /Page\n/Type /Page'), 'application/pdf')).toBe(3)
  })

  it('does not count the page TREE as a page', () => {
    // /Type /Pages is the node that holds them. Counting it would report one page too many on
    // every PDF ever made.
    expect(pageCountOf(pdf('/Type /Pages /Count 2\n/Type /Page\n/Type /Page'), 'application/pdf')).toBe(2)
  })

  it('tolerates no space after /Type', () => {
    expect(pageCountOf(pdf('/Type/Page\n/Type/Page'), 'application/pdf')).toBe(2)
  })

  it('falls back to the page tree count when page objects are not visible', () => {
    expect(pageCountOf(pdf('/Type /Pages /Count 12'), 'application/pdf')).toBe(12)
  })

  it('shrugs rather than guessing when it cannot tell', () => {
    // A compressed object stream hides both signals. Null means unknown, and the caller proceeds —
    // refusing on uncertainty is what killed the first real upload.
    expect(pageCountOf(pdf('binary garbage with no markers'), 'application/pdf')).toBeNull()
  })

  it('returns null for an image, which is one page by definition', () => {
    expect(pageCountOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')).toBeNull()
  })

  it('never throws, whatever it is handed', () => {
    // The property that actually matters. This ran inside the upload path and took it down.
    expect(() => pageCountOf(Buffer.alloc(0), 'application/pdf')).not.toThrow()
    expect(() => pageCountOf(Buffer.from([0, 255, 0, 255]), 'application/pdf')).not.toThrow()
  })
})
