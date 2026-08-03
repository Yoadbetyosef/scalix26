import type { ContextProvider } from '../types'

// Catalog / Products / Categories / Inventory / Stock / Pricing — catalog_products, plus the sub-products
// (Studio variants) hanging off them. Business-wide data, safe to surface to any customer.
//
// The sub-products matter: a sofa is sold as a shell with fabric or configuration options, each with its
// own price, and a catalog row alone can't answer "does the Cavalo have a sub-product?". Without them the
// AI answered, correctly but uselessly, that it had no information — the data existed and simply wasn't
// being handed over.

const CATALOG_LIMIT = 60
const VARIANT_LIMIT = 300

export const catalogProvider: ContextProvider = {
  key: 'catalog',
  label: 'Products & Inventory',
  keywords: [
    'product', 'products', 'catalog', 'catalogue', 'sell', 'selling', 'price', 'prices', 'cost', 'how much',
    'stock', 'in stock', 'inventory', 'available', 'availability', 'do you have', 'do you carry', 'carry', 'offer',
    'category', 'brand', 'model',
    // Sub-product vocabulary, so the question routes here at all.
    'sub product', 'subproduct', 'sub-product', 'variant', 'variants', 'option', 'options', 'configuration',
    'fabric', 'upholstery', 'finish', 'size', 'sizes',
  ],
  async fetch(req, db) {
    const { data, count } = await db
      .from('catalog_products')
      .select('id, name, sku, category, brand, price, availability_status, showroom_quantity, warehouse_quantity, storage_quantity, incoming_quantity', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')
      .order('name')
      .limit(CATALOG_LIMIT)
    if (!data || data.length === 0) return { available: false, text: 'No products are listed in the catalog yet — do not name specific products, prices, or stock.' }

    // Sub-products, keyed back to the catalog row they belong to. Two hops: a Studio product carries the
    // catalog_product_id, and the variants hang off the Studio product. Empty for a tenant without Studio.
    const byCatalogId = new Map<string, string[]>()
    const { data: studioProducts } = await db
      .from('studio_products')
      .select('id, catalog_product_id')
      .eq('tenant_id', req.tenantId)
      .not('catalog_product_id', 'is', null)
    const studioIds = (studioProducts ?? []).map((p) => p.id as string)
    if (studioIds.length) {
      const { data: variants } = await db
        .from('studio_variants')
        .select('product_id, label, name, fabric_name, sku, price')
        .eq('tenant_id', req.tenantId)
        .in('product_id', studioIds)
        .order('position')
        .limit(VARIANT_LIMIT)
      const catalogIdOf = new Map((studioProducts ?? []).map((p) => [p.id as string, p.catalog_product_id as string]))
      for (const v of variants ?? []) {
        const catalogId = catalogIdOf.get(v.product_id as string)
        if (!catalogId) continue
        // Best display name: its own name, else the fabric, else the label — same rule the UI uses.
        const title = (v.name as string) || (v.fabric_name as string) || (v.label as string) || 'Option'
        const bits = [
          v.fabric_name && v.fabric_name !== title ? `fabric ${v.fabric_name}` : null,
          v.price != null ? `$${v.price}` : null,
          v.sku ? `SKU ${v.sku}` : null,
        ].filter(Boolean)
        if (!byCatalogId.has(catalogId)) byCatalogId.set(catalogId, [])
        byCatalogId.get(catalogId)!.push(`    · ${title}${bits.length ? ` — ${bits.join(', ')}` : ''}`)
      }
    }

    const lines: string[] = []
    for (const p of data) {
      const onHand = (p.showroom_quantity || 0) + (p.warehouse_quantity || 0) + (p.storage_quantity || 0)
      const price = p.price != null ? `$${p.price}` : 'price on request'
      const avail = onHand > 0 ? `${onHand} in stock` : (p.availability_status ? String(p.availability_status).replace(/_/g, ' ') : 'out of stock')
      const incoming = (p.incoming_quantity || 0) > 0 ? `, ${p.incoming_quantity} incoming` : ''
      lines.push(`- ${p.name}${p.brand ? ` (${p.brand})` : ''} — ${price} — ${avail}${incoming}${p.category ? ` [${p.category}]` : ''}`)
      const subs = byCatalogId.get(p.id as string)
      if (subs?.length) {
        lines.push(`  sub-products (${subs.length}):`)
        lines.push(...subs)
      } else {
        // Stated explicitly so the AI can answer "no" with confidence instead of "I don't know".
        lines.push('  no sub-products')
      }
    }

    // Never let a cap read as the whole truth — the AI would otherwise report the shown count as the total.
    const total = count ?? data.length
    if (total > data.length) lines.push(`\n(Showing ${data.length} of ${total} products — ask about a specific product name for the rest.)`)
    return { available: true, text: lines.join('\n') }
  },
}
