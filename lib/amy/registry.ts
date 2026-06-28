import { type ContextSource, type SourceContext } from './types'
import { conversationsSource } from './sources/conversations'
import { transcriptSource } from './sources/transcript'
import { contactsSource } from './sources/contacts'
import { appointmentsSource } from './sources/appointments'
import { leadsSource } from './sources/leads'
import { metricsSource } from './sources/metrics'
import { knowledgeSource } from './sources/knowledge'
import { analyzeSource } from './sources/analyze'
import { searchSource } from './sources/search'

// ── The registry ────────────────────────────────────────────────────────────────
// Add a new data source here (one line) and Amy can use it immediately. Her core
// agent loop + prompt never change. Every source is strictly tenant-scoped.
const SOURCES: ContextSource[] = [
  metricsSource,
  analyzeSource,
  searchSource,
  conversationsSource,
  transcriptSource,
  contactsSource,
  appointmentsSource,
  leadsSource,
  knowledgeSource,
]

export function amyTools() {
  return SOURCES.map((s) => ({ name: s.id, description: s.description, input_schema: s.input_schema }))
}

export async function runTool(ctx: SourceContext, name: string, args: Record<string, unknown>): Promise<string> {
  const source = SOURCES.find((s) => s.id === name)
  if (!source) return `No such tool: ${name}.`
  try {
    const out = await source.run(ctx, args || {})
    return (out || 'No results.').slice(0, 6000)
  } catch {
    return 'I couldn’t retrieve that just now.'
  }
}

// A broad tenant-scoped snapshot for grounding the realtime voice agent (which can't
// call tools mid-conversation). Reuses the same sources — single source of truth.
export async function buildSnapshot(ctx: SourceContext): Promise<string> {
  const [metrics, lastTranscript, recent, appts, leads] = await Promise.all([
    runTool(ctx, 'get_business_metrics', { days: 7 }),
    runTool(ctx, 'get_conversation_transcript', {}),
    runTool(ctx, 'search_conversations', { limit: 5 }),
    runTool(ctx, 'get_appointments', { when: 'upcoming' }),
    runTool(ctx, 'get_leads', {}),
  ])
  return [metrics, lastTranscript, recent, appts, leads].join('\n\n')
}
