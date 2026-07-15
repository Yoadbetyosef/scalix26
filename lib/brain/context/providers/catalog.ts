import type { ContextProvider } from '../types'

// Catalog / Products / Categories / Inventory / Stock / Pricing — all live on catalog_products.
// Business-wide data (safe to surface to any customer).
export const catalogProvider: ContextProvider = {
  key: 'catalog',
  label: 'Products & Inventory',
  keywords: [
    'product', 'products', 'catalog', 'catalogue', 'sell', 'selling', 'price', 'prices', 'cost', 'how much',
    'stock', 'in stock', 'inventory', 'available', 'availability', 'do you have', 'do you carry', 'carry', 'offer',
    'category', 'brand', 'model',
  ],
  async fetch(req, db) {
    const { data } = await db
      .from('catalog_products')
      .select('name, sku, category, brand, price, availability_status, showroom_quantity, warehouse_quantity, storage_quantity, incoming_quantity')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')
      .order('name')
      .limit(25)
    if (!data || data.length === 0) return { available: false, text: 'No products are listed in the catalog yet — do not name specific products, prices, or stock.' }
    const lines = data.map((p) => {
      const onHand = (p.showroom_quantity || 0) + (p.warehouse_quantity || 0) + (p.storage_quantity || 0)
      const price = p.price != null ? `$${p.price}` : 'price on request'
      const avail = onHand > 0 ? `${onHand} in stock` : (p.availability_status ? String(p.availability_status).replace(/_/g, ' ') : 'out of stock')
      const incoming = (p.incoming_quantity || 0) > 0 ? `, ${p.incoming_quantity} incoming` : ''
      return `- ${p.name}${p.brand ? ` (${p.brand})` : ''} — ${price} — ${avail}${incoming}${p.category ? ` [${p.category}]` : ''}`
    })
    return { available: true, text: lines.join('\n') }
  },
}
