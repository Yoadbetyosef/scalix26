// Run the real detector against real sites and print what each tier concluded.
//
// This is a LIVE NETWORK script, not a unit test: it makes outbound requests to third parties, the
// answers change when those sites change, and it has no place in CI. It exists to answer the only
// question that matters before Tier 5 gets built out — how much of the real web do tiers 1–4
// actually cover?
//
//   node_modules/.bin/tsx scripts/test-detection.ts                 # the five defaults
//   node_modules/.bin/tsx scripts/test-detection.ts shop.com b.com  # your own list
//   INGESTION_DEBUG=1 node_modules/.bin/tsx scripts/test-detection.ts
import { detectPlatform } from '../lib/ingestion/detector'
import { newTelemetry } from '../lib/ingestion/types'

// One per tier we expect to exercise. Public storefronts and reference sites only — a handful of
// polite probes each, at one request per second, which is what the rate limiter enforces anyway.
const DEFAULT_URLS = [
  'https://shop.polymer-project.org',   // Shopify-style storefront
  'https://woocommerce.com',            // WordPress/WooCommerce marketing site
  'https://www.rei.com',                // large retailer, structured data
  'https://books.toscrape.com',         // static HTML shop, no structured data → tier 5 territory
  'https://linear.app',                 // SPA — should come back spa_unsupported
]

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

async function main() {
  const urls = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const targets = urls.length ? urls : DEFAULT_URLS

  console.log(`\nDetecting ${targets.length} site(s). Honest UA first, browser headers only on 403/429.\n`)
  console.log(`${pad('SITE', 34)} ${pad('RESULT', 16)} ${pad('PLATFORM', 18)} ${pad('CONF', 6)} ${pad('PRODUCTS', 9)} MS`)
  console.log('─'.repeat(100))

  const rows: Array<{ url: string; result: string; ms: number; fallbacks: number }> = []

  for (const url of targets) {
    const telemetry = newTelemetry()
    const started = Date.now()
    let result: Awaited<ReturnType<typeof detectPlatform>>
    try {
      result = await detectPlatform(url, { telemetry, budgetMs: 20_000 })
    } catch (e) {
      console.log(`${pad(url, 34)} ${pad('THREW', 16)} ${(e as Error).message}`)
      continue
    }
    const ms = Date.now() - started

    const verdict = result.sourceType ?? `— ${result.reason ?? 'unknown'}`
    console.log(
      `${pad(url.replace(/^https?:\/\//, ''), 34)} ${pad(verdict, 16)} ${pad(result.platform ?? '—', 18)} ` +
      `${pad(result.confidence.toFixed(2), 6)} ${pad(result.estimatedProducts?.toLocaleString() ?? '—', 9)} ${ms}`,
    )

    // The probe trail is the useful part when a result is surprising.
    for (const p of result.probeResults) {
      console.log(`   ${p.ok ? '✓' : '·'} tier ${p.tier} ${pad(p.name, 24)} ${pad(String(p.status ?? ''), 5)} ${p.detail ?? ''} (${p.ms}ms)`)
    }
    if (telemetry.uaFallbacks > 0) console.log(`   ⚠ browser-header fallback used ${telemetry.uaFallbacks}×`)
    if (telemetry.robotsBlocked.length) console.log(`   ⚠ robots.txt blocked: ${telemetry.robotsBlocked.join(', ')}`)
    console.log()

    rows.push({ url, result: verdict, ms, fallbacks: telemetry.uaFallbacks })
  }

  const automated = rows.filter((r) => !r.result.startsWith('—')).length
  console.log('─'.repeat(100))
  console.log(`${automated}/${rows.length} readable automatically · ${rows.filter((r) => r.fallbacks > 0).length} needed browser headers · ` +
    `median ${Math.round(median(rows.map((r) => r.ms)))}ms\n`)
}

const median = (ns: number[]) => {
  if (!ns.length) return 0
  const s = [...ns].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

main().catch((e) => { console.error(e); process.exit(1) })
