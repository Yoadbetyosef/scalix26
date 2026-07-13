import type { EngineKey } from './types'

// Weekly Scoreboard — every Monday the CEO must know if each of the 4 engines is winning or losing.
// Pure scoring (variance / attainment / status / trend) is unit-tested; persistence is behind a deps seam.

export type ScoreStatus = 'green' | 'yellow' | 'red'
export type ScoreTrend = 'up' | 'flat' | 'down'

export interface ScoredEntry {
  variance: number // actual − goal
  attainment: number // actual / goal
  status: ScoreStatus
  trend: ScoreTrend
}

// green ≥ 100% of goal, yellow ≥ 85%, red below; unknown actual = yellow (not yet reported).
export function scoreEntry(goal: number, actual: number | null, priorActual?: number | null): ScoredEntry {
  const a = actual ?? 0
  const attainment = goal > 0 ? a / goal : a > 0 ? 1 : 0
  const status: ScoreStatus = actual == null ? 'yellow' : attainment >= 1 ? 'green' : attainment >= 0.85 ? 'yellow' : 'red'
  const trend: ScoreTrend = priorActual == null || actual == null ? 'flat' : actual > priorActual * 1.02 ? 'up' : actual < priorActual * 0.98 ? 'down' : 'flat'
  return { variance: a - goal, attainment, status, trend }
}

// Default weekly metric per engine (editable later).
export const ENGINE_METRIC: Record<EngineKey, { metricKey: string; label: string }> = {
  direct: { metricKey: 'customers', label: 'New customers' },
  affiliate: { metricKey: 'active_affiliates', label: 'Active affiliates' },
  whiteLabel: { metricKey: 'agencies', label: 'Agencies signed' },
  expansion: { metricKey: 'arpu', label: 'ARPU ($)' },
}

export interface ScoreboardRow {
  engine: EngineKey
  metricKey: string
  goalValue: number
  actualValue: number | null
  notes: string | null
  owner: string | null
}
export interface ScoreboardItem extends ScoreboardRow { label: string; scored: ScoredEntry }

export function assembleScoreboard(rows: ScoreboardRow[], priorRows: ScoreboardRow[]): ScoreboardItem[] {
  const priorByEngine = new Map(priorRows.map((r) => [`${r.engine}:${r.metricKey}`, r.actualValue]))
  return rows.map((r) => ({
    ...r,
    label: ENGINE_METRIC[r.engine]?.label ?? r.metricKey,
    scored: scoreEntry(r.goalValue, r.actualValue, priorByEngine.get(`${r.engine}:${r.metricKey}`) ?? null),
  }))
}

// ── Persistence seam ─────────────────────────────────────────────────────────────────────────────────
export interface ScoreboardDeps {
  getWeek(weekStart: string): Promise<ScoreboardRow[]>
  upsert(weekStart: string, row: ScoreboardRow, actor: string, at: string): Promise<void>
}
const dbDeps: ScoreboardDeps = {
  async getWeek(weekStart) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_scoreboard')
      .select('engine, metric_key, goal_value, actual_value, notes, owner').eq('week_start', weekStart)
    return ((data as Array<{ engine: EngineKey; metric_key: string; goal_value: number; actual_value: number | null; notes: string | null; owner: string | null }> | null) ?? [])
      .map((r) => ({ engine: r.engine, metricKey: r.metric_key, goalValue: r.goal_value, actualValue: r.actual_value, notes: r.notes, owner: r.owner }))
  },
  async upsert(weekStart, row, _actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_scoreboard').upsert(
      { week_start: weekStart, engine: row.engine, metric_key: row.metricKey, goal_value: row.goalValue, actual_value: row.actualValue, notes: row.notes, owner: row.owner, updated_at: at },
      { onConflict: 'week_start,engine,metric_key' },
    )
  },
}
let deps: ScoreboardDeps = dbDeps
export function __setScoreboardDepsForTests(d: ScoreboardDeps | null) { deps = d ?? dbDeps }

// Monday (UTC) of the week containing `date` — the canonical week_start.
export function weekStartOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)) // back to Monday
  return d.toISOString().slice(0, 10)
}
function priorWeek(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10)
}

export async function getScoreboard(weekStart: string): Promise<ScoreboardItem[]> {
  const [rows, prior] = await Promise.all([deps.getWeek(weekStart), deps.getWeek(priorWeek(weekStart))])
  return assembleScoreboard(rows, prior)
}
export async function saveScoreboardEntry(weekStart: string, row: ScoreboardRow, actor: string): Promise<void> {
  await deps.upsert(weekStart, row, actor, new Date().toISOString())
}
