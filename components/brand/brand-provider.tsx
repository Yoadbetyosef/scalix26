'use client'

import { createContext, useContext } from 'react'
import type { BrandData } from '@/lib/partner/brand'

const BrandContext = createContext<BrandData | null>(null)

export function BrandProvider({ brand, children }: { brand: BrandData; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}

// Client components read the resolved brand (name, logo, powered-by, support) without re-fetching.
export function useBrand(): BrandData | null {
  return useContext(BrandContext)
}
