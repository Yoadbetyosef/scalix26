import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { loadHomeData, loadShell } from './data'
import { HomeClient } from './home-client'

// The v2 home screen.
//
// ── THE PAGE DOES NOT AWAIT THE NUMBERS ─────────────────────────────────────────────────────────────
//
// loadHomeData's PROMISE is handed to the client and this function returns. The shell — hero, rail,
// composer — streams immediately and is interactive before a single figure resolves; each panel then
// fills in inside its own Suspense boundary as the data lands.
//
// That is the whole change. The queries are untouched: getDashboardData and getImpactData are called
// exactly as the dashboard calls them, unoptimised, uncached and un-re-windowed. What changed is when
// the UI waits, which was the actual fault — the canvas draws 24ms after mount, so every second the
// owner spent looking at nothing was spent before mount.
//
// READ-ONLY throughout. Action buttons render, so the layout is honest about what the real screen has,
// and are disabled with title="v2 preview".

export const dynamic = 'force-dynamic'

export default async function V2Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/dashboard')

  // One indexed row, and the shell cannot be drawn without it — the business name and the number she
  // answers on are both in the first paint.
  const shell = await loadShell(tenantId)

  // Deliberately NOT awaited.
  const dataPromise = loadHomeData(tenantId)

  return <HomeClient shell={shell} dataPromise={dataPromise} />
}
