import { NextRequest, NextResponse } from 'next/server'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { getScoreboard, saveScoreboardEntry, weekStartOf, ENGINE_METRIC, type ScoreboardRow } from '@/lib/command-center/scoreboard'
import type { EngineKey } from '@/lib/command-center/types'

const ENGINES: EngineKey[] = ['direct', 'affiliate', 'whiteLabel', 'expansion']
const isWeek = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// GET ?week=YYYY-MM-DD (defaults to the current week's Monday) → scored per-engine entries.
export async function GET(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const q = req.nextUrl.searchParams.get('week')
  const week = isWeek(q) ? weekStartOf(new Date(q + 'T00:00:00Z')) : weekStartOf(new Date())
  return NextResponse.json({ week, items: await getScoreboard(week), engines: ENGINES.map((e) => ({ engine: e, ...ENGINE_METRIC[e] })) })
}

// POST → upsert one engine's weekly goal/actual/notes/owner.
export async function POST(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood

  let b: { week?: string; engine?: string; metricKey?: string; goalValue?: number; actualValue?: number | null; notes?: string | null; owner?: string | null }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!isWeek(b.week) || !ENGINES.includes(b.engine as EngineKey)) return NextResponse.json({ error: 'week + valid engine required' }, { status: 400 })
  const engine = b.engine as EngineKey
  const row: ScoreboardRow = {
    engine, metricKey: b.metricKey || ENGINE_METRIC[engine].metricKey,
    goalValue: Number(b.goalValue ?? 0),
    actualValue: b.actualValue == null || b.actualValue === undefined ? null : Number(b.actualValue),
    notes: b.notes ?? null, owner: b.owner ?? null,
  }
  if (!Number.isFinite(row.goalValue)) return NextResponse.json({ error: 'goalValue must be a number' }, { status: 400 })
  await saveScoreboardEntry(weekStartOf(new Date(b.week + 'T00:00:00Z')), row, f.email)
  return NextResponse.json({ ok: true })
}
