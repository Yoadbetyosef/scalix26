import { Lock } from 'lucide-react'
import { ScalixLogo } from '@/components/brand/scalix-logo'

export interface BrandConfig {
  name: string
  tagline: string
  logo: React.ReactNode
  trialDays?: number
  industry?: string
}

// Branding is resolved by hostname. Add a host here to white-label a new domain.
export const BRANDS: Record<string, BrandConfig> = {
  'app.mylocksmithai.com': {
    name: 'myLocksmith Ai',
    tagline: 'Sign in to your AI employee platform',
    trialDays: 14,
    industry: 'Locksmith',
    logo: (
      <div className="flex items-center gap-2">
        <Lock className="w-7 h-7 text-[#1a1f36]" strokeWidth={2.5} />
        <span className="text-2xl text-[#1a1f36] tracking-tight">
          <span className="font-light">my</span>
          <span className="font-black uppercase">Locksmith</span>
          <span className="font-light text-lg">Ai</span>
        </span>
      </div>
    ),
  },
  'app.scalix26.com': {
    name: 'Scalix26',
    tagline: 'Sign in to your AI employee platform',
    trialDays: 14,
    logo: (
      <div className="flex items-center gap-2.5">
        <ScalixLogo size={30} />
        <span className="text-xl font-semibold uppercase tracking-[0.08em] text-[#1a1f36]">Scalix26</span>
      </div>
    ),
  },
}

// Default/fallback for any unknown host (localhost, previews, *.vercel.app, etc.)
// is the neutral Scalix26 brand — never the locksmith brand.
export const DEFAULT_BRAND: BrandConfig = BRANDS['app.scalix26.com']

// Short aliases for the `?from=` override (used for local/preview testing where the
// hostname can't match a real brand domain).
const ALIASES: Record<string, string> = {
  mylocksmith: 'app.mylocksmithai.com',
  scalix26: 'app.scalix26.com',
}

// Resolve the active brand from a hostname. Works on the server (pass the request
// host) and on the client (omit to read window.location.hostname).
export function resolveBrand(hostname?: string, fromParam?: string): BrandConfig {
  if (fromParam && ALIASES[fromParam] && BRANDS[ALIASES[fromParam]]) return BRANDS[ALIASES[fromParam]]

  let host = hostname
  if (host == null && typeof window !== 'undefined') host = window.location.hostname
  host = (host || '').toLowerCase().replace(/:\d+$/, '') // strip any :port

  // Exact host match, then suffix match (handles www. / sub-host variants).
  if (BRANDS[host]) return BRANDS[host]
  for (const key of Object.keys(BRANDS)) {
    if (host === key || host.endsWith(`.${key}`)) return BRANDS[key]
  }
  return DEFAULT_BRAND
}

// Client-side convenience: resolve from window (hostname + optional ?from= alias).
export function detectBrand(): BrandConfig {
  if (typeof window === 'undefined') return DEFAULT_BRAND
  const fromParam = new URLSearchParams(window.location.search).get('from') || undefined
  return resolveBrand(window.location.hostname, fromParam)
}
