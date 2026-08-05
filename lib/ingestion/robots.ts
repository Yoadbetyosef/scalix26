// robots.txt, honoured on the crawl tiers (product feeds, JSON-LD pages, tier-4 HTML). Tiers 1 and 2
// are the platform's own public product API, which the site owner exposed deliberately and which
// robots.txt does not govern.
//
// A disallow is NOT an error and NOT something to route around. The tenant owns that file: we stop,
// record exactly which path was refused, and the UI tells them the one line to add — or offers the
// CSV path instead. Overriding it would be trivial and is exactly what we don't do.
import { politeFetch } from './http'
import type { FetchOptions } from './http'

export interface RobotsRules {
  // Ordered longest-prefix-first so the most specific rule wins, as the spec requires.
  rules: Array<{ allow: boolean; path: string }>
  crawlDelayMs: number | null
  // Sitemap: lines are group-independent and are the site telling us exactly where its index is —
  // worth more than guessing at conventional paths.
  sitemaps: string[]
  fetched: boolean            // false when robots.txt was missing or unreadable → everything allowed
}

export const NO_ROBOTS: RobotsRules = { rules: [], crawlDelayMs: null, sitemaps: [], fetched: false }

// Parses the groups that apply to us: the wildcard group plus any group naming ScalixBot. A named
// group wins outright when present — that is the file's whole purpose.
export function parseRobots(text: string): RobotsRules {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }>; delay: number | null }> = []
  const sitemaps: string[] = []
  let current: (typeof groups)[number] | null = null
  let lastWasAgent = false

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [], delay: null }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    // Sitemap lines belong to the file, not to a user-agent group, so they are read whether or not
    // a group has been opened yet.
    if (key === 'sitemap' && value) { sitemaps.push(value); continue }
    if (!current) continue
    if (key === 'disallow') current.rules.push({ allow: false, path: value })
    else if (key === 'allow') current.rules.push({ allow: true, path: value })
    else if (key === 'crawl-delay') { const n = Number(value); if (Number.isFinite(n)) current.delay = n * 1000 }
  }

  const named = groups.find((g) => g.agents.some((a) => a.includes('scalixbot')))
  const wildcard = groups.find((g) => g.agents.includes('*'))
  const chosen = named ?? wildcard
  if (!chosen) return { rules: [], crawlDelayMs: null, sitemaps, fetched: true }
  return {
    // An empty Disallow means "allow everything" and must not become a prefix match on "".
    rules: chosen.rules.filter((r) => r.path !== '' || r.allow).sort((a, b) => b.path.length - a.path.length),
    crawlDelayMs: chosen.delay,
    sitemaps,
    fetched: true,
  }
}

export async function fetchRobots(origin: string, opts: FetchOptions = {}): Promise<RobotsRules> {
  try {
    const res = await politeFetch(new URL('/robots.txt', origin).toString(), { ...opts, accept: 'text/plain,*/*;q=0.8', retries: 0 })
    if (!res.ok || !res.body.trim()) return NO_ROBOTS
    return parseRobots(res.body)
  } catch { return NO_ROBOTS }
}

// Longest matching prefix decides; ties go to Allow, per the de-facto standard.
export function isAllowed(rules: RobotsRules, url: string): boolean {
  if (!rules.fetched || !rules.rules.length) return true
  let path: string
  try { const u = new URL(url); path = u.pathname + u.search } catch { return true }
  for (const r of rules.rules) {
    if (matches(r.path, path)) return r.allow
  }
  return true
}

// Supports the two wildcards real robots.txt files use: * (any run) and $ (end of path).
function matches(pattern: string, path: string): boolean {
  if (!pattern) return false
  if (!pattern.includes('*') && !pattern.includes('$')) return path.startsWith(pattern)
  const re = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'),
  )
  return re.test(path)
}
