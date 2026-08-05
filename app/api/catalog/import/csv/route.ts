import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { createCsvSource, enqueueSync } from '@/lib/catalog/sources'
import { parseProductCsv, rowsToProducts, PRODUCT_FIELDS, type ProductField } from '@/lib/ingestion/sources/csv'

// Uploading a product list. This is the path every failure state points at, so it has to work
// without a website, without an API, and without anyone reading documentation first.
//
// Two-step by design: post the file and get back the columns we recognised, so the tenant can fix
// the mapping before anything is stored. Post it again with a mapping and it becomes a source.
export const maxDuration = 30

const MAX_BYTES = 2 * 1024 * 1024   // 2 MB — roughly 20,000 products; past that it wants a real feed

export async function POST(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Expected a file upload.' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a CSV file to upload.' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 2 MB. Split it, or connect the shop directly.' }, { status: 400 })
  }

  const text = await file.text()
  const parsed = parseProductCsv(text)
  if (!parsed.rows.length) return NextResponse.json({ error: 'That file has no rows we could read.' }, { status: 400 })

  // A mapping the tenant corrected on screen wins over the one we guessed.
  const submitted = form.get('mapping')
  let mapping: Array<ProductField | null> = parsed.mapping
  if (typeof submitted === 'string' && submitted.trim()) {
    try {
      const parsedMapping = JSON.parse(submitted) as Array<ProductField | null>
      if (Array.isArray(parsedMapping)) mapping = parsedMapping
    } catch { /* keep the auto mapping */ }
  }

  const products = rowsToProducts(parsed.rows, mapping)

  // Step one: nothing was mapped to a product name, so there is nothing to store yet. Hand back what
  // we found and let them point at the right column.
  if (!products.length) {
    return NextResponse.json({
      needsMapping: true,
      headers: parsed.headers,
      mapping,
      fields: PRODUCT_FIELDS,
      sample: parsed.rows.slice(0, 5),
      error: 'None of these columns look like a product name — tell us which one is.',
    }, { status: 200 })
  }

  const { source, error } = await createCsvSource(s.tenantId, file.name || 'products.csv', text, mapping)
  if (error || !source) return NextResponse.json({ error: error ?? 'Could not save that file.' }, { status: 400 })

  await enqueueSync(s.tenantId, source.id, 'initial')

  return NextResponse.json({
    source,
    headers: parsed.headers,
    mapping,
    productCount: products.length,
    queued: true,
  })
}
