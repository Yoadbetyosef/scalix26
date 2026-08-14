import { triggerLine } from './inbox-read'
import type { HeldDraft } from './drafts'

// WHAT THE OWNER ACTUALLY READS.
//
// Split out from notify.ts, which imports Twilio and Resend and constructs a Resend client at module
// scope — importing it to check a sentence means needing an API key to test a string. The text is the
// part of this feature most worth pinning down, so it lives where it can be tested on its own.
//
// "You have a draft waiting, open the app" is the version of this that fails: the owner has to find
// their password before they can find out what was written. The whole draft travels in the body.

// ── WHAT A LONG DRAFT COSTS ─────────────────────────────────────────────────────────────────────────
//
// An SMS is not one message. GSM-7 fits 160 characters, or 153 each once it concatenates; a single
// character outside that alphabet switches the WHOLE message to UCS-2, where those numbers become 70
// and 67. Twilio bills per segment.
//
// Measured before any of this was written: a typical 81-character draft produced a 344-character
// message in UCS-2 — SIX segments — and a ten-character draft still cost four. The characters
// responsible were not the customer's; they were the decoration in this file, a "·" and a pair of
// curly quotes. Those are now ASCII in the SMS (the email and the screens keep the typography), which
// roughly doubles what fits per segment.
//
// What remains is a real limit, and the honest answer to "what happens when the draft is long" is:
// it splits up to a cap, then the DRAFT is the only part that gets shortened, and the email always
// carries the whole thing. Never the link, never the line promising nothing goes out.

/** Three segments. Enough for any reply the SMS/social prompt asks for, and a bounded bill. */
export const SMS_SEGMENT_BUDGET = 3

const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
/** These cost two characters each in GSM-7. */
const GSM7_EXT = '^{}\\[~]|€'

export const isGsm7 = (s: string) => [...s].every((c) => GSM7.includes(c) || GSM7_EXT.includes(c))

/** How many characters this message actually costs, and how many segments that is. */
export function smsCost(s: string): { encoding: 'GSM-7' | 'UCS-2'; length: number; segments: number } {
  if (isGsm7(s)) {
    const length = [...s].reduce((n, c) => n + (GSM7_EXT.includes(c) ? 2 : 1), 0)
    return { encoding: 'GSM-7', length, segments: length <= 160 ? 1 : Math.ceil(length / 153) }
  }
  const length = [...s].reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0)
  return { encoding: 'UCS-2', length, segments: length <= 70 ? 1 : Math.ceil(length / 67) }
}

/**
 * OUR typography, flattened for the wire. The customer's own words are left alone: an accented name
 * or a Hebrew sentence is content, and mangling it to save a segment would be answering the wrong
 * question. Only the punctuation this file adds is normalised.
 */
const plain = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/·/g, '-')
    .replace(/ /g, ' ')

/** SMS is one screen on a lock screen. Question, draft, why, link — in that order, nothing else. */
export function smsBody(draft: HeldDraft, who: string, agentName: string, url: string): string {
  const build = (body: string) => plain([
    `${agentName} drafted a reply to ${who}${draft.channel ? ` (${draft.channel})` : ''}.`,
    draft.inbound_excerpt ? `\nThey asked: ${draft.inbound_excerpt}` : '',
    `\n"${body}"`,
    `\nHeld: ${triggerLine(draft.reasons ?? [])}`,
    `\nSend, edit or take it over: ${url}`,
    `\nNothing goes out until you decide.`,
  ].filter(Boolean).join('\n'))

  const full = build(draft.body)
  if (smsCost(full).segments <= SMS_SEGMENT_BUDGET) return full

  // Over budget: shorten the draft, and SAY SO. A silently truncated reply is worse than a long one —
  // the owner would approve words believing they had read all of them.
  const tail = ' [cut - full reply in your email and at the link]'
  let body = draft.body
  while (body.length > 40 && smsCost(build(body + tail)).segments > SMS_SEGMENT_BUDGET) {
    body = body.slice(0, Math.max(40, Math.floor(body.length * 0.9)))
  }
  return build(body.trimEnd() + tail)
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function emailBody(draft: HeldDraft, who: string, agentName: string, url: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#0e0e11">
      <p style="font-size:15px;margin:0 0 4px">${escapeHtml(agentName)} drafted a reply to <strong>${escapeHtml(who)}</strong>${draft.channel ? ` on ${escapeHtml(draft.channel)}` : ''}.</p>
      ${draft.inbound_excerpt ? `<p style="font-size:13px;color:#6b6b73;margin:0 0 14px">They asked: ${escapeHtml(draft.inbound_excerpt)}</p>` : ''}
      <div style="background:#f7f7f8;border-left:2px solid #f5a524;border-radius:10px;padding:12px 14px;font-size:15px;line-height:1.45">
        ${escapeHtml(draft.body).replace(/\n/g, '<br/>')}
      </div>
      <p style="font-size:12px;color:#6b4708;background:#fef3dc;border-radius:8px;padding:8px 10px;margin:10px 0 16px">
        Held: ${escapeHtml(triggerLine(draft.reasons ?? []))}. Nothing goes out until you decide.
      </p>
      <a href="${url}" style="display:inline-block;background:#d9f224;color:#20260a;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px;font-size:14px">Send, edit, or take it over</a>
    </div>`
}
