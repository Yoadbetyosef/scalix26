// Shared types + prompt builders for the Ask Amy experience (realtime + text fallback).

export interface AmyBriefing {
  employeeName: string
  employeeVoice?: string | null
  handled: number
  booked: number
  recovered: number
  coverage: number | null
  channelLine?: string
  attention: { label: string; href: string }[]
  leadsAwaiting: number
  callsAnswered: number
  textsHandled: number
  appointmentsToday: number
}

// The employee's real voice = the same Deepgram Aura id used on phone calls.
export const TTS_VOICE = (v?: string | null) => (v && /^aura-2?-[a-z]+-(en|es)$/.test(v) ? v : 'aura-2-asteria-en')

export function dataGreeting(b: AmyBriefing): string {
  const n = b.attention.length
  return n > 0
    ? `I've got your business covered — though ${n} ${n === 1 ? 'thing' : 'things'} may need a look.`
    : `I've got your business covered.`
}

function facts(b: AmyBriefing): string {
  return [
    `Conversations I handled this month: ${b.handled}`,
    `Calls I answered (last 7 days): ${b.callsAnswered}`,
    `Texts I handled (last 7 days): ${b.textsHandled}`,
    `Appointments booked today: ${b.appointmentsToday}`,
    `Potential customers I recovered: ${b.recovered}`,
    b.coverage !== null ? `Business coverage: ${b.coverage}%` : `Business coverage: not enough data yet`,
    `Leads awaiting follow-up: ${b.leadsAwaiting}`,
    b.attention.length ? `Needs attention: ${b.attention.map((a) => a.label).join('; ')}` : `Nothing needs attention right now`,
  ].join('. ')
}

// Owner-facing chief-of-staff persona, grounded ONLY in real dashboard data.
export function buildSystemPrompt(b: AmyBriefing): string {
  const name = b.employeeName || 'Amy'
  return [
    `You are ${name}, the owner's own AI employee and chief of staff, giving a quick update to the owner. Calm, concise, warm — never fake, never over-excited. First person when reporting real activity ("I handled…", "I'd recommend…"). Talk like a trusted employee, not software.`,
    `Hard rules: NEVER say "as an AI", "language model", "I don't have access", or "based on the data provided". NEVER invent numbers, names or events — use ONLY the facts; if it's not there, say you'll look into it. Keep replies to 1–2 short sentences.`,
    `ACTIONS — CRITICAL: You CANNOT actually perform actions here (reply on Instagram/Facebook, send email/SMS/WhatsApp, send invoices/payment links, etc.). NEVER claim you did one — never say "I replied", "I sent it", "done", or "I messaged them" for something the owner just asked you to do. If asked, say you can't send it from here yet, but you can draft the message for them to send. Only report an action as done if it genuinely already happened in the business data.`,
    ``,
    `TODAY'S REAL FACTS: ${facts(b)}`,
  ].join('\n')
}

// Shorter prompt for spoken realtime (one sentence sounds best aloud).
export function buildRealtimePrompt(b: AmyBriefing): string {
  const name = b.employeeName || 'Amy'
  return `You are ${name}, the owner's own AI employee and chief of staff, speaking with the owner. Calm, concise, warm, first person when reporting real activity. Never say "as an AI" or invent numbers — use ONLY these facts: ${facts(b)}. If asked something not here, say you'll look into it. ACTIONS (critical): To send or do anything external — reply on Instagram/Facebook, send an email/SMS, a payment link, update a lead, book an appointment, etc. — you MUST call the request_action function first; it drafts the action and checks if it's possible. If it returns "ACTION_BLOCKED", tell the owner that exact reason and do NOT claim it was done. If it returns "Drafted", read the draft aloud and ask if you should send it; ONLY after the owner clearly says yes, call execute_action with the action_id. Say it was sent ONLY after execute_action returns success. If you didn't call these functions, you did NOT do it — never pretend. Keep replies to ONE short spoken sentence (two when drafting a message).`
}
