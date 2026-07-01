import type { SupabaseClient } from '@supabase/supabase-js'

export interface SkillDef { type: string; name: string; description: string }

// Skills shown as toggles on the AI employee edit page. (Bilingual is handled by the
// per-agent voice-language picker, so it isn't a skill toggle here.) The AI pipeline
// reads the active rows from the `skills` table and feeds them into the prompt +
// trigger detection — so toggling these changes real behavior.
export const SKILL_CATALOG: SkillDef[] = [
  { type: 'appointment_booking', name: 'Appointment Booking', description: 'Collects service type, preferred date/time, address, and contact info to book appointments.' },
  { type: 'lead_qualification', name: 'Lead Qualification', description: 'Asks about the problem, urgency, property type, and size before connecting to your team.' },
  { type: 'faq_answering', name: 'FAQ Answering', description: 'Answers common questions using your knowledge base (hours, pricing, services).' },
  { type: 'review_request', name: 'Review Request', description: 'After a completed job, asks customers to leave a Google review with your link.' },
  { type: 'emergency_routing', name: 'Emergency Routing', description: 'Detects emergency keywords and immediately escalates to your emergency line.' },
  { type: 'estimate_request', name: 'Estimate Request', description: 'Collects everything needed for a quote and notifies you instantly.' },
  { type: 'appointment_reminders', name: 'Appointment Reminders', description: 'Sends SMS reminders before scheduled appointments.' },
  { type: 'payment_collection', name: 'Payment Collection', description: 'Creates and sends secure Stripe payment links to customers.' },
]

// Default-on skills every new agent starts with (first agent AND additional agents).
export const DEFAULT_ACTIVE_SKILLS = ['appointment_booking', 'lead_qualification', 'faq_answering']

export function skillName(type: string): string {
  return SKILL_CATALOG.find((s) => s.type === type)?.name || type
}

export function isKnownSkill(type: string): boolean {
  return SKILL_CATALOG.some((s) => s.type === type)
}

// Seed the default active skills for a freshly created agent so every agent starts
// identical. No-op if the agent already has skill rows.
export async function seedDefaultSkills(supabase: SupabaseClient, tenantId: string, agentId: string): Promise<void> {
  const { count } = await supabase.from('skills').select('id', { count: 'exact', head: true }).eq('ai_employee_id', agentId)
  if ((count ?? 0) > 0) return
  const rows = DEFAULT_ACTIVE_SKILLS.map((type) => ({ tenant_id: tenantId, ai_employee_id: agentId, name: skillName(type), type, active: true }))
  await supabase.from('skills').insert(rows)
}
