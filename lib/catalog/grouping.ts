// Turning a pile of near-identical rows into something a person can say out loud.
//
// The problem this exists for, from real production data: a caller asks for "the emerald cut halo
// ring" and 30 rows come back spanning $369–$2,349. Reading them aloud sounds broken. Picking one
// silently quotes a wrong price. The answer a salesperson gives is a range and a question — "that
// runs from $439 to $1,769 depending on the metal, which were you looking at?" — and that is what
// this module builds.
//
// Pure: no database, no network, no framework. Everything here is decided from the rows themselves.

export interface Groupable {
  id: string
  title: string
  price: number | null
  currency: string | null
  sku: string | null
  availability: string | null
  productUrl: string | null
  imageUrl: string | null
  source: 'inventory' | 'website' | 'both'
  inStock?: number | null          // physical inventory only
}

export interface ProductGroup {
  label: string                    // what the cluster IS, spoken: "Emerald Cut Diamond Hidden Halo Engagement Ring"
  count: number
  priceMin: number | null
  priceMax: number | null
  currency: string
  axis: string | null              // "metal" — null when nothing in the vocabulary explains the spread
  axisValues: string[]             // ≤4, cheapest first, so the agent can offer real choices
  sku: string | null               // only when the cluster is a single product
  availability: string | null
  inStock: number | null
  exampleUrl: string | null
  source: 'inventory' | 'website' | 'both'
}

// ── Tokens ──────────────────────────────────────────────────────────────────────────────────────────

// Words that carry no distinguishing signal in a product title or a caller's phrasing. Kept small on
// purpose: "gold" and "small" look like noise and are the whole answer.
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'with', 'in', 'for', 'of', 'to', 'my', 'your', 'is', 'it', 'that', 'this', 'do', 'you', 'have', 'got', 'much', 'how', 'what', 'i', 'im', 'looking', 'want', 'need', 'please'])

export function tokenize(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t))
}

// ── The trade vocabulary ────────────────────────────────────────────────────────────────────────────
//
// Why a dictionary rather than a generic diff: a generic diff of these titles produces the axis
// "with Round Shared Prong Pavé / with Gallery", and an agent that asks "which one — with Round
// Shared Prong Pavé, or with Gallery?" sounds like a database reading its own columns. A curated
// vocabulary produces "which metal?", which is what a person asks.
//
// It will not cover everything, and it is not meant to. When nothing matches, the fallback answer —
// a range with no axis named — is still a good answer.

interface Attribute { axis: string; match: RegExp; label: (m: string) => string }

const VOCABULARY: Attribute[] = [
  {
    axis: 'metal',
    match: /\b(platinum|sterling silver|silver|white gold|rose gold|yellow gold|gold|titanium|tungsten|brass|bronze|stainless steel|stainless|steel|nickel|chrome|copper|aluminium|aluminum|10k|14k|18k|24k)\b/i,
    label: (m) => m.toLowerCase(),
  },
  {
    axis: 'size',
    // Ring sizes, dimensions, and clothing sizes all read as "size" to a caller.
    match: /\b(\d+(?:\.\d+)?\s?(?:mm|cm|inch|inches|in|")|size\s?\d+(?:\.\d+)?|x{0,2}small|medium|large|x{0,2}l\b|xs\b)\b/i,
    label: (m) => m.toLowerCase().replace(/\s+/g, ' '),
  },
  {
    axis: 'finish',
    match: /\b(polished|brushed|satin|matte|antique|oil[- ]rubbed|powder[- ]coated|anodized|anodised|plated)\b/i,
    label: (m) => m.toLowerCase(),
  },
  {
    axis: 'colour',
    match: /\b(black|white|red|blue|green|pink|purple|yellow|orange|brown|grey|gray|clear|natural)\b/i,
    label: (m) => m.toLowerCase(),
  },
  {
    axis: 'carat',
    match: /\b(\d+(?:\.\d+)?)\s?(?:ct|carat|carats)\b/i,
    label: (m) => m.toLowerCase().replace(/\s+/g, ''),
  },
]

const attributeIn = (text: string, attr: Attribute): string | null => {
  const m = text.match(attr.match)
  return m ? attr.label(m[0]) : null
}

// ── Clustering ──────────────────────────────────────────────────────────────────────────────────────

const MIN_STEM_TOKENS = 3          // fewer than this and "Ring" would cluster the whole shop
// Half, not more: the real titles carry a 7-token product name followed by 5 tokens of variation
// ("… Engagement Ring" + "Platinum with Round Shared Prong Pavé"), which is a ratio of 0.58. A
// stricter gate refuses to cluster exactly the family this exists to collapse.
const MIN_STEM_RATIO = 0.5

const commonPrefix = (a: string[], b: string[]): string[] => {
  const out: string[] = []
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) break
    out.push(a[i])
  }
  return out
}

// Rows whose titles share a long leading run of words are the same product in different guises.
// Prefix rather than bag-of-words because these titles are template-generated and the template puts
// the product first and the variation last — which is exactly the structure we want to exploit.
export function clusterByStem<T extends Groupable>(rows: T[]): Array<{ stem: string[]; members: T[] }> {
  const withTokens = rows.map((r) => ({ row: r, tokens: tokenize(r.title) }))
  // Sorting by title puts template siblings adjacent, so a single greedy pass finds them.
  withTokens.sort((a, b) => a.row.title.localeCompare(b.row.title))

  const clusters: Array<{ stem: string[]; members: T[] }> = []
  for (const { row, tokens } of withTokens) {
    const current = clusters[clusters.length - 1]
    if (current) {
      const stem = commonPrefix(current.stem, tokens)
      const shorter = Math.min(current.stem.length, tokens.length)
      if (stem.length >= MIN_STEM_TOKENS && stem.length >= shorter * MIN_STEM_RATIO) {
        current.stem = stem
        current.members.push(row)
        continue
      }
    }
    clusters.push({ stem: tokens, members: [row] })
  }
  return clusters
}

// ── Choosing what to ask about ──────────────────────────────────────────────────────────────────────

// Of the attributes that vary inside a cluster, the useful one to ask about is the one that moves the
// price. In the real data, metal takes the same ring from $179 to $1,189 while the setting barely
// moves it — so asking "which metal?" gets the caller to a real number in one question, and asking
// about the setting does not.
export function pickAxis(members: Groupable[]): { axis: string | null; values: string[] } {
  const priced = members.filter((m) => m.price !== null)
  let best: { axis: string; values: string[]; spread: number } | null = null

  for (const attr of VOCABULARY) {
    const byValue = new Map<string, number[]>()
    for (const m of priced) {
      const v = attributeIn(m.title, attr)
      if (!v) continue
      if (!byValue.has(v)) byValue.set(v, [])
      byValue.get(v)!.push(m.price as number)
    }
    if (byValue.size < 2) continue                     // it isn't a distinguishing axis if it doesn't vary

    const averages = [...byValue.entries()].map(([v, prices]) => ({ v, avg: prices.reduce((s, p) => s + p, 0) / prices.length }))
    averages.sort((a, b) => a.avg - b.avg)
    const spread = averages[averages.length - 1].avg / Math.max(averages[0].avg, 0.01)
    if (!best || spread > best.spread) {
      best = { axis: attr.axis, values: averages.map((a) => a.v), spread }
    }
  }

  // A spread this small isn't worth a question — the range alone answers the caller.
  if (!best || best.spread < 1.15) return { axis: null, values: [] }
  return { axis: best.axis, values: best.values.slice(0, 4) }
}

// ── Building the answer ─────────────────────────────────────────────────────────────────────────────

// The label a person would use for the cluster. Title-cased from the stem, trailing connectives
// trimmed, so "emerald cut diamond hidden halo engagement ring in" reads as a product, not a fragment.
function labelFor(stem: string[], members: Groupable[]): string {
  if (members.length === 1) return members[0].title
  const words = [...stem]
  while (words.length && ['in', 'with', 'and', 'for', 'the', 'of'].includes(words[words.length - 1])) words.pop()
  if (!words.length) return members[0].title
  // Take the casing from a real title where we can, so "14K" doesn't become "14k".
  const original = members[0].title.split(/\s+/).slice(0, words.length).join(' ').replace(/[,\-–—]\s*$/, '')
  return original || words.join(' ')
}

const pickAvailability = (members: Groupable[]): string | null => {
  // Anything in stock makes the cluster in stock — a caller asking for "the emerald ring" can be
  // sold the one that exists.
  if (members.some((m) => m.availability === 'in_stock')) return 'in_stock'
  if (members.length && members.every((m) => m.availability === 'out_of_stock')) return 'out_of_stock'
  return members.find((m) => m.availability)?.availability ?? null
}

export function groupProducts(rows: Groupable[], limit = 3): ProductGroup[] {
  if (!rows.length) return []

  const clusters = clusterByStem(rows)
  const groups: ProductGroup[] = clusters.map(({ stem, members }) => {
    const prices = members.map((m) => m.price).filter((p): p is number => p !== null)
    const { axis, values } = members.length > 1 ? pickAxis(members) : { axis: null, values: [] }
    const stock = members.map((m) => m.inStock).filter((n): n is number => typeof n === 'number')
    const sources = new Set(members.map((m) => m.source))

    return {
      label: labelFor(stem, members),
      count: members.length,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      currency: members.find((m) => m.currency)?.currency ?? 'USD',
      axis,
      axisValues: values,
      sku: members.length === 1 ? members[0].sku : null,
      availability: pickAvailability(members),
      inStock: stock.length ? stock.reduce((s, n) => s + n, 0) : null,
      exampleUrl: members.find((m) => m.productUrl)?.productUrl ?? null,
      source: sources.size > 1 ? 'both' : ([...sources][0] ?? 'website'),
    }
  })

  // Biggest cluster first: with a templated catalogue the largest group is almost always the thing
  // the caller meant, and the long tail is noise from a shared word.
  groups.sort((a, b) => b.count - a.count)
  return groups.slice(0, limit)
}

// ── The sentence ────────────────────────────────────────────────────────────────────────────────────

const money = (n: number, currency: string): string => {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''
  const rounded = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return symbol ? `${symbol}${rounded}` : `${rounded} ${currency}`
}

// A line the agent can say almost verbatim. Supplied alongside the structured fields rather than
// instead of them — the model may rephrase, but it should never have to compute a price range from
// raw rows while a caller waits.
export function speakableAnswer(g: ProductGroup): string {
  const single = g.count === 1 || g.priceMin === g.priceMax
  if (g.priceMin === null) {
    return single ? `We have the ${g.label}, but I don't have a price for it here.`
      : `We have ${g.count} versions of the ${g.label}, but I don't have prices for them here.`
  }
  if (single) return `The ${g.label} is ${money(g.priceMin, g.currency)}.`

  const range = `${money(g.priceMin, g.currency)} to ${money(g.priceMax as number, g.currency)}`
  // With an axis we can ask a real question. Without one — and this is the common case the
  // vocabulary will keep missing — the range plus "a few versions" is still a good answer.
  if (g.axis) {
    return `The ${g.label} runs from ${range} depending on the ${g.axis}. Which one were you looking at?`
  }
  return `There are a few versions of the ${g.label}, from ${range}. Do you know which one you're after?`
}
