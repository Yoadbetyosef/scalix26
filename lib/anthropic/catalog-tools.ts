import type Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/server'

// Catalog lookup for the TEXT pipeline. The AI answers availability questions ONLY from real
// catalog data (gated by the `inventory` module). Never invents inventory.

export const CATALOG_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_catalog',
    description:
      'Look up products in the business catalog to answer availability questions (e.g. "do you have this sofa", "is it in the showroom", "how many are available", "when is it coming in", "what similar products do you have"). ALWAYS call this before stating any availability — never guess or invent inventory.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The product the customer asked about — name, SKU, category, or brand.' },
      },
      required: ['query'],
    },
  },
]

export function isCatalogTool(name: string): boolean {
  return name === 'search_catalog'
}

// Trigger the tool turn only when the message looks like an availability question.
export function detectCatalogIntent(content: string): boolean {
  const t = (content || '').toLowerCase()
  const words = ['in stock', 'out of stock', 'available', 'availability', 'do you have', 'do you sell', 'do you carry', 'how many', 'showroom', 'warehouse', 'in store', 'pick up', 'pickup', 'when will', 'coming in', 'shipment', 'arrive', 'similar', 'inventory', 'in the store']
  return words.some((w) => t.includes(w))
}

export function catalogPromptGuidance(): string {
  return [
    'BUSINESS CATALOG: You can look up real inventory with the search_catalog tool. Rules:',
    '- State availability ONLY from tool results — never invent products, quantities, or dates.',
    '- Distinguish showroom vs warehouse vs storage vs incoming (e.g. "2 in the showroom and 6 in the warehouse").',
    '- Mention an expected arrival date ONLY if the tool returns one.',
    "- If the product isn't in the results, say you don't see it in the catalog yet and offer to have someone confirm.",
    "- If you're unsure, say you'll check with the team. Keep it natural and brief.",
  ].join('\n')
}

// Executor — queries the tenant's catalog and returns a compact JSON result for the model.
export async function executeCatalogTool(name: string, input: Record<string, unknown>, tenantId: string): Promise<string> {
  if (name !== 'search_catalog') return JSON.stringify({ error: 'unknown tool' })
  const query = String(input.query || '').trim()
  try {
    const db = createAdminClient()
    let q = db.from('catalog_products').select('name, sku, category, brand, price, availability_status, showroom_quantity, warehouse_quantity, storage_quantity, incoming_quantity, expected_arrival_date, ai_notes, tags')
      .eq('tenant_id', tenantId).neq('status', 'discontinued').limit(6)
    if (query) {
      const s = query.replace(/[%,]/g, '')
      q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%,category.ilike.%${s}%,brand.ilike.%${s}%`)
    }
    const { data, error } = await q
    if (error) return JSON.stringify({ error: 'lookup failed' })
    const results = (data || []).map((p) => ({
      name: p.name, sku: p.sku, category: p.category, brand: p.brand, price: p.price,
      availability: p.availability_status,
      showroom: p.showroom_quantity, warehouse: p.warehouse_quantity, storage: p.storage_quantity,
      incoming: p.incoming_quantity, expected_arrival: p.expected_arrival_date,
      total_available: (p.showroom_quantity || 0) + (p.warehouse_quantity || 0) + (p.storage_quantity || 0),
      notes_for_ai: p.ai_notes || undefined,
    }))
    return JSON.stringify({ query, count: results.length, results })
  } catch {
    return JSON.stringify({ error: 'lookup failed' })
  }
}
