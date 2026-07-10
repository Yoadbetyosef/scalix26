import { createAdminClient } from '@/lib/supabase/server'

// Configurable platform settings (admin-editable). Cached briefly so hot paths don't hit the DB on
// every read. Prices are NEVER hardcoded in the UI — they resolve here with a sane default.

const DEFAULTS: Record<string, unknown> = {
  wl_onboarding_fee_cents: 75000, // $750 one-time
  wl_monthly_cents: 9700,         // $97 / month
}

let cache: { at: number; values: Record<string, unknown> } | null = null
const TTL = 60_000

export async function getPlatformSettings(): Promise<Record<string, unknown>> {
  if (cache && Date.now() - cache.at < TTL) return cache.values
  const { data } = await createAdminClient().from('platform_settings').select('key, value')
  const values = { ...DEFAULTS }
  for (const r of data || []) values[r.key] = r.value
  cache = { at: Date.now(), values }
  return values
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const v = await getPlatformSettings()
  return v[key] as T
}

export async function getWholesalePricing(): Promise<{ onboarding_fee_cents: number; monthly_cents: number }> {
  const v = await getPlatformSettings()
  return { onboarding_fee_cents: Number(v.wl_onboarding_fee_cents) || 75000, monthly_cents: Number(v.wl_monthly_cents) || 9700 }
}

export function clearPlatformSettingsCache() { cache = null }
