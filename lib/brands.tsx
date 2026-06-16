import { Lock, Zap } from 'lucide-react'

export interface BrandConfig {
  name: string
  logo: React.ReactNode
  trialDays?: number
  industry?: string
}

export const BRANDS: Record<string, BrandConfig> = {
  mylocksmith: {
    name: 'My Locksmith AI',
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
}

export const DEFAULT_BRAND: BrandConfig = {
  name: 'AI Employee Platform',
  trialDays: 20,
  logo: (
    <div className="flex items-center justify-center">
      <div className="w-10 h-10 bg-[#4ecdc4] rounded-xl flex items-center justify-center">
        <Zap className="w-5 h-5 text-white" />
      </div>
    </div>
  ),
}

export function detectBrand(): BrandConfig {
  if (typeof window === 'undefined') return DEFAULT_BRAND
  const hostname = window.location.hostname
  const fromParam = new URLSearchParams(window.location.search).get('from') || ''
  const fromHost = Object.keys(BRANDS).find(key => hostname.includes(key)) || ''
  return BRANDS[fromParam] ?? BRANDS[fromHost] ?? DEFAULT_BRAND
}
