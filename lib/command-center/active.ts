import { BASE_ASSUMPTIONS } from './defaults'
import { getOrCreateBaseConfig, getResolvedAssumptions } from './store'
import type { CommandCenterAssumptions } from './types'

// The single entry point for the running engine to obtain assumptions. It ALWAYS reads the persisted
// active config (seeding a Base config from defaults on first use). The seed defaults are used at runtime
// ONLY when persistence is unavailable (e.g. the migration isn't applied yet) — and that case is reported
// via `persisted:false` so the UI can flag it. No page hardcodes assumptions.

export interface ActiveModel {
  assumptions: CommandCenterAssumptions
  persisted: boolean
  configId: string | null
}

export async function loadActiveAssumptions(actor: string): Promise<ActiveModel> {
  try {
    const cfg = await getOrCreateBaseConfig(actor)
    return { assumptions: await getResolvedAssumptions(cfg.id), persisted: true, configId: cfg.id }
  } catch {
    return { assumptions: BASE_ASSUMPTIONS, persisted: false, configId: null }
  }
}
