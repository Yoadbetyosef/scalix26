import { createAdminClient } from '@/lib/supabase/server'
import { ALL_MODULES, DEFAULT_MODULE_STATE, type ModuleKey, type ModuleState } from '@/lib/modules'

export type ModuleFlags = Record<ModuleKey, ModuleState>

/** The global feature-flag state for every module (server-side, bypasses RLS). Missing rows
 * default to 'enabled', so a partial/empty table never hides modules unexpectedly. */
export async function getModuleFlags(): Promise<ModuleFlags> {
  const flags = Object.fromEntries(ALL_MODULES.map((m) => [m, DEFAULT_MODULE_STATE])) as ModuleFlags
  try {
    const db = createAdminClient()
    const { data } = await db.from('module_flags').select('module, state')
    for (const row of data || []) {
      if ((ALL_MODULES as string[]).includes(row.module)) flags[row.module as ModuleKey] = row.state as ModuleState
    }
  } catch {
    /* table missing / error → all default 'enabled' */
  }
  return flags
}
