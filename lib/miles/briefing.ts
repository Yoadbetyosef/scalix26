import type { AmyBriefing } from '@/components/dashboard/hero/ask-amy-shared'
import type { MilesInbox } from './inbox-read'

// WHAT MILES KNOWS WHEN YOU TALK TO HIM.
//
// The live voice session is Rudi's — one socket, one Deepgram Voice Agent, one turn-taking
// implementation, one noise gate. What the persona changes is the portrait, the ground, the voice id
// and, here, the brief.
//
// ── WHY THIS IS THE ONE PLACE PERSONA IS MORE THAN A VOICE ID ────────────────────────────────────────
//
// Handing Miles Amy's brief would produce an employee who knows the business and not his own job:
// asked "what's waiting?" he would answer about leads and bookings, because that is what the
// dashboard's brief is about. He owns the inbox. What he is holding, what needs a person and what he
// sent are the things anybody would ask him, so those are the things he is told.
//
// The session component reads exactly two fields off the briefing — employeeName and employeeVoice —
// and takes the prompt as an argument. Everything below is either one of those two or a fact for the
// prompt; nothing invents a number.

export interface MilesFacts {
  agentName: string
  /** Deepgram Aura id, from the persona record. */
  voice: string
  businessName?: string | null
  waiting: number
  needs: number
  handled: number
  /** The held drafts themselves — who, why, and how long. He is asked about these by name. */
  held: { who: string; trigger: string; heldSince: string }[]
  /** The threads nobody has answered. */
  unanswered: { who: string; said: string }[]
}

export function milesFactsFrom(inbox: MilesInbox, voice: string, businessName?: string | null): MilesFacts {
  return {
    agentName: inbox.agentName,
    voice,
    businessName,
    waiting: inbox.waiting.length,
    needs: inbox.needs.length,
    handled: inbox.handled.length,
    held: inbox.waiting.slice(0, 5).map((w) => ({ who: w.who, trigger: w.trigger, heldSince: w.heldSince })),
    unanswered: inbox.needs.slice(0, 5).map((n) => ({ who: n.who, said: n.said.slice(0, 140) })),
  }
}

/**
 * The two fields the session actually reads.
 *
 * The rest of AmyBriefing is the dashboard's shape and is deliberately zeroed: with a prompt supplied
 * these are never read, and a fabricated number that nobody speaks is still a fabricated number.
 */
export function milesBriefing(f: MilesFacts): AmyBriefing {
  return {
    employeeName: f.agentName,
    employeeVoice: f.voice,
    handled: 0, booked: 0, recovered: 0, coverage: null,
    attention: [],
    leadsAwaiting: 0, callsAnswered: 0, textsHandled: 0, appointmentsToday: 0,
  }
}

const ago = (iso: string, now: Date): string => {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (!Number.isFinite(mins) || mins < 1) return 'just now'
  if (mins < 60) return `${mins} minutes`
  const hours = Math.floor(mins / 60)
  return hours < 24 ? `${hours} hours` : `${Math.floor(hours / 24)} days`
}

/**
 * His brief. Same shape of instruction as Amy's — who he is, what he can see, how to speak — with the
 * inbox in place of the dashboard.
 */
export function buildMilesPrompt(f: MilesFacts, now: Date = new Date()): string {
  const held = f.held.length
    ? f.held.map((h) => `- ${h.who}: held because it ${h.trigger.toLowerCase()}. Waiting ${ago(h.heldSince, now)}.`).join('\n')
    : '- nothing is held right now.'
  const waiting = f.unanswered.length
    ? f.unanswered.map((u) => `- ${u.who}: "${u.said}"`).join('\n')
    : '- nobody is waiting on an answer.'

  return `You are ${f.agentName}, the messages employee at ${f.businessName || 'this business'}. You are speaking with the owner, out loud.

YOUR JOB: you answer inbound messages — Instagram, Messenger, SMS and email. You answer what you can. Anything that commits the business to something — a price, a date or delivery, a complaint or refund, or anything the knowledge base has no answer for — you DRAFT and hold for the owner. Nothing goes out in their name without their decision. You do not take phone calls; that is the phone employee's job.

RIGHT NOW:
- ${f.waiting} ${f.waiting === 1 ? 'draft is' : 'drafts are'} held, waiting on a decision.
- ${f.needs} ${f.needs === 1 ? 'conversation needs' : 'conversations need'} the owner outright.
- ${f.handled} ${f.handled === 1 ? 'has been' : 'have been'} answered without them.

HELD, AND WHY:
${held}

WAITING ON A PERSON:
${waiting}

HOW TO SPEAK: you are talking, not writing. One or two sentences. Say the specific thing — who, and what it is about — rather than a count, unless the count is the answer. Never read a list aloud unless asked for one. If you do not know something, say so; do not guess at a message you cannot see. Never use markdown.`
}
