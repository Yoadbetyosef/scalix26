import type Anthropic from '@anthropic-ai/sdk'
import { retrieveProducts, toToolPayload } from '@/lib/catalog/retrieval'

// Catalog lookup for the TEXT pipeline. The AI answers product questions ONLY from real catalog data
// (gated by the `inventory` module). Never invents inventory.
//
// ONE tool, not two. The business has two catalogs — physical inventory and the website — and which
// one answers is a business rule, not a decision to hand a model mid-conversation. lib/catalog/
// retrieval merges them field by field and returns a single answer per product, which is what makes
// it impossible for the agent to contradict itself by reading two records about the same thing.
// The voice agent and the /catalog test box call that same function.

export const CATALOG_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_catalog',
    description:
      'Look up products in the business catalog to answer questions about what the business sells, what something costs, or whether it is available (e.g. "do you have this sofa", "how much is the emerald cut ring", "what does the Kwikset 660 cost", "is it in the showroom", "when is it coming in"). ALWAYS call this before stating any product, price, or availability — never guess or invent one. Do NOT call it for appointments, hours, directions, or anything that is not a product.',
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
  const words = ['in stock', 'out of stock', 'available', 'availability', 'do you have', 'do you sell', 'do you carry', 'how many', 'showroom', 'warehouse', 'in store', 'pick up', 'pickup', 'when will', 'coming in', 'shipment', 'arrive', 'similar', 'inventory', 'in the store',
    // Price questions reach the catalog too — the website half of it is where prices live.
    'how much', 'price', 'cost', 'costs', 'pricing', 'quote', 'charge']
  return words.some((w) => t.includes(w))
}

export function catalogPromptGuidance(): string {
  return [
    'BUSINESS CATALOG: You can look up real products with the search_catalog tool. Rules:',
    '- State any product, price, or availability ONLY from tool results — never invent one.',
    '- The tool returns a ready line in `say`. Use it, or say the same thing in your own words.',
    '- When a result has `price_from` and `price_to`, the business sells several versions. Give the RANGE and ask which one — never read the versions out one by one, and never quote a single price as if it were the only one.',
    '- When `varies_by` is present, that is what to ask about ("which metal?"). When it is absent, just say there are a few versions and give the range.',
    '- Distinguish showroom vs warehouse vs storage vs incoming when the tool reports them.',
    "- If `found` is false, say you don't see it in the catalog and offer to check with the team. Never substitute a product you think is similar.",
  ].join('\n')
}

// Executor — one call into the shared retrieval path, returning the compact object the model speaks
// from. Deliberately thin: everything about how the two catalogs merge, how near-identical products
// collapse into a range, and what a miss sounds like lives in lib/catalog/retrieval.
export async function executeCatalogTool(name: string, input: Record<string, unknown>, tenantId: string): Promise<string> {
  if (name !== 'search_catalog') return JSON.stringify({ error: 'unknown tool' })
  const query = String(input.query || '').trim()
  try {
    return toToolPayload(await retrieveProducts(tenantId, query, 'text'))
  } catch {
    // A lookup that fails must not become a hallucinated product.
    return JSON.stringify({ found: false, say: "I can't reach the catalog right now — I can check with the team and get back to you." })
  }
}
