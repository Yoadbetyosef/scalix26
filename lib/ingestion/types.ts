// Shared vocabulary for catalog ingestion.
//
// PURITY RULE for everything under lib/ingestion: node builtins and zod only. No `@/` imports, no
// next/*, no supabase client. This directory is compiled into BOTH the Next app and the standalone
// catalog-worker; the moment it reaches for a framework, the worker stops building. Anything that
// needs I/O beyond fetch (a database, a clock you can control, an LLM) is injected by the caller.

export const SOURCE_TYPES = [
  'shopify_api', 'woocommerce_api', 'product_feed', 'jsonld_crawl', 'html_ai', 'csv_upload', 'manual',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const SOURCE_STATUSES = ['pending', 'detecting', 'syncing', 'active', 'failed', 'paused'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

export type Availability = 'in_stock' | 'out_of_stock' | 'unknown'

// Why a source can't be read automatically. These are states the tenant can act on, not error dumps —
// the UI turns each one into a sentence and a next step, so keep them specific.
export type FailureReason =
  | 'spa_unsupported'      // the page is an empty mount point; the products are drawn by JavaScript
  | 'robots_blocked'       // their robots.txt disallows the paths we'd need to read
  | 'unreachable'          // DNS/TLS/timeout — the site didn't answer
  | 'blocked'              // answered, but with 401/403 and the browser-header retry didn't help
  | 'no_products_found'    // readable, but nothing on it looks like a product
  | 'fetch_failed'         // transport failure mid-run
  | 'llm_failed'           // tier 4 couldn't produce a usable shape

// ── Detection ───────────────────────────────────────────────────────────────────────────────────────

export interface ProbeResult {
  tier: number
  name: string
  ok: boolean
  status?: number          // HTTP status, when there was one
  detail?: string          // one line, for the source's error_log and the test script
  ms: number
}

export interface DetectionResult {
  sourceType: SourceType | null      // null = nothing automatic works; the tenant goes to CSV
  platform: string | null            // free text for display: "Shopify", "WooCommerce"
  confidence: number                 // 0–1
  reason?: FailureReason             // set whenever sourceType is null
  estimatedProducts: number | null   // cheap count when the platform offers one, else null
  probeResults: ProbeResult[]
  // Discovered during detection and worth not rediscovering: the sitemap that had product URLs, the
  // feed we found, the API base that answered. Stored on the source as extraction_pattern.
  pattern?: ExtractionPattern
}

// Whatever lets the next sync skip discovery. Shape varies by tier, so it is deliberately loose —
// it is written and read by the adapter that produced it, and by nothing else.
export interface ExtractionPattern {
  tier: SourceType
  apiBase?: string
  sitemapUrl?: string
  feedUrl?: string
  productUrlPattern?: string
  // Tier 4 only: the field mapping Haiku worked out once, replayed deterministically afterwards.
  htmlSelectors?: Record<string, string>
  discoveredAt?: string
}

// ── Products ────────────────────────────────────────────────────────────────────────────────────────

// What an adapter yields: as close to the source's own words as possible. Normalisation happens once,
// afterwards, so a parsing bug is visible in raw_payload rather than baked into the stored row.
export interface RawProduct {
  externalId?: string | null
  title?: string | null
  description?: string | null
  price?: string | number | null
  comparePrice?: string | number | null
  currency?: string | null
  sku?: string | null
  imageUrl?: string | null
  productUrl?: string | null
  availability?: string | null
  raw: unknown
}

export interface NormalizedProduct {
  externalId: string
  title: string
  description: string | null
  price: number | null
  comparePrice: number | null
  currency: string
  sku: string | null
  imageUrl: string | null
  productUrl: string | null
  availability: Availability
  rawPayload: unknown
  contentHash: string
}

// ── The adapter contract ────────────────────────────────────────────────────────────────────────────

// The minimum an adapter needs to know about the source it is reading. Deliberately not the database
// row: the worker maps its row into this, so lib/ingestion never learns the schema.
export interface SourceRef {
  id: string
  tenantId: string
  sourceUrl: string
  sourceType: SourceType
  extractionPattern?: ExtractionPattern | null
}

export interface FetchContext {
  onProgress?: (p: { current: number; total: number | null; phase: string }) => void | Promise<void>
  // Tier 4 injects its LLM here rather than importing one — the worker and the app hand in different
  // clients, and the unit tests hand in neither.
  llm?: LlmExtractor
  // Bumped by the http layer whenever the honest bot UA is refused and the browser headers succeed.
  // The worker persists it so we can measure how often we have to fall back.
  telemetry?: Telemetry
  // Tier 5 calls this the first time it works out where a page keeps its fields. The worker saves it
  // to extraction_pattern, and every later sync replays it instead of paying for the model.
  onPattern?: (pattern: ExtractionPattern) => void | Promise<void>
  signal?: AbortSignal
}

export interface Telemetry {
  uaFallbacks: number
  pagesFetched: number
  llmCalls: number
  llmCostUsd: number
  robotsBlocked: string[]     // the paths robots.txt refused, for the tenant-facing message
}

export const newTelemetry = (): Telemetry => ({
  uaFallbacks: 0, pagesFetched: 0, llmCalls: 0, llmCostUsd: 0, robotsBlocked: [],
})

// Tier 4's escape hatch. Returns parsed JSON matching the schema it was asked for, plus the usage the
// caller needs in order to meter the spend.
export interface LlmExtractor {
  extract(input: { prompt: string; maxTokens?: number }): Promise<{
    json: unknown
    inputTokens: number
    outputTokens: number
    model: string
    requestId?: string
  }>
}

// Thrown when a source cannot be read for a reason the tenant can act on. Anything else is a bug and
// should surface as an ordinary Error with a stack.
export class IngestionError extends Error {
  constructor(public reason: FailureReason, message: string) {
    super(message)
    this.name = 'IngestionError'
  }
}
