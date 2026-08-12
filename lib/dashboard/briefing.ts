import type { PresenceState } from '@/components/dashboard/hero/dashboard-hero'
import type { AmyBriefing } from '@/components/dashboard/hero/ask-amy-shared'
import type { getImpactData } from './impact'
import type { getDashboardData } from './overview'

// The hero's inputs, moved here VERBATIM from app/dashboard/page.tsx.
//
// ── WHY IT MOVED ────────────────────────────────────────────────────────────────────────────────────
//
// /v2's Talk button was inert, and the reason was not the voice layer — it was this block. The briefing
// Amy speaks from was computed inline in the dashboard PAGE's render, so nothing outside that function
// could obtain it. A second screen wanting the same conversation had no way to ask for the same facts.
//
// Same treatment as getDashboardData: lifted unchanged into lib/, imported by both screens. It takes
// what the page already loaded and adds no query of its own.
//
// ── THE BODY BELOW IS UNCHANGED ─────────────────────────────────────────────────────────────────────
//
// Extracted programmatically from the page rather than retyped — lib/invoices/OUTSTANDING.md §7h. The
// only edits are mechanical: `brainAgentId` became a returned field instead of an outer-scope
// assignment, and the three inputs the block closed over are now parameters. Every value, every
// comparison and every sentence is byte-identical to what /dashboard rendered before.

type Dash = Awaited<ReturnType<typeof getDashboardData>>
type Impact = Awaited<ReturnType<typeof getImpactData>>

export interface HeroInputs {
  employeeName: string
  employeeVoice: string | null
  brainAgentId: string | undefined
  briefing: AmyBriefing
  presenceState: PresenceState
  stateSentence: string
  idleSentence: string
  figures: { value: number | null; suffix?: string; label: string }[]
}

export function buildHeroInputs(
  aiEmployees: Dash['aiEmployees'],
  impactData: Impact,
  appointments_list: Dash['appointments_list'],
  leads_list: Dash['leads_list'],
  stats: Dash['stats'],
): HeroInputs {
  const employeesTyped = aiEmployees as { id?: string; name?: string | null; status?: string | null; voice?: string | null }[]
  const primaryEmployee = employeesTyped.find((e) => e.status === 'active') || employeesTyped[0]
  const employeeName = primaryEmployee?.name || 'Your AI'
  const employeeVoice = primaryEmployee?.voice ?? null
  const brainAgentId = primaryEmployee?.id

  const handled = impactData.conversationsManaged.value
  const booked = appointments_list.filter((a) => a.status === 'confirmed' || a.status === 'completed').length
  const recovered = leads_list.filter((l) => Boolean((l as { responded_at?: string | null }).responded_at)).length
  const answered = impactData.coveragePct.value
  const attentionCount = impactData.attention.length

  const presenceState: PresenceState = attentionCount > 0 ? 'attention' : handled > 0 ? 'working' : 'ready'

  // The AI's spoken status. `idleSentence` is the "all caught up" variant; the reactive header
  // (AttentionSentence) shows the live unresolved count and falls back to idleSentence at zero.
  const idleSentence =
    handled > 0
      ? 'On duty — watching every channel. Nothing needs you.'
      : 'On duty, watching your channels. Nothing needs you yet.'
  const stateSentence =
    attentionCount > 0
      ? `${attentionCount} ${attentionCount === 1 ? 'thing needs' : 'things need'} your attention.`
      : idleSentence

  // Amy's knowledge — built entirely from the real data already on this page.
  const todayStr = new Date().toLocaleDateString('en-CA')
  const appointmentsToday = appointments_list.filter((a) => a.slot_date === todayStr && a.status !== 'cancelled').length
  const briefing = {
    employeeName,
    employeeVoice,
    handled,
    booked,
    recovered,
    coverage: answered,
    channelLine: impactData.channelBreakdown.map((c) => `${c.count} ${c.label}`).join(', ') || undefined,
    attention: impactData.attention.map((a) => ({ label: a.label, href: a.href })),
    leadsAwaiting: stats.activeLeads,
    callsAnswered: stats.totalCalls,
    textsHandled: stats.textMessages,
    appointmentsToday,
  }

  // The figures were written inline in the JSX; same four values, same order, same labels.
  const figures = [
    { value: handled, label: 'Handled' },
    { value: booked, label: 'Booked' },
    { value: recovered, label: 'Recovered' },
    { value: answered, suffix: '%', label: 'Answered' },
  ]

  return { employeeName, employeeVoice, brainAgentId, briefing, presenceState, stateSentence, idleSentence, figures }
}
