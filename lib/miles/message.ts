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

/** SMS is one screen on a lock screen. Question, draft, why, link — in that order, nothing else. */
export function smsBody(draft: HeldDraft, who: string, agentName: string, url: string): string {
  const lines = [
    `${agentName} drafted a reply to ${who}${draft.channel ? ` (${draft.channel})` : ''}.`,
    draft.inbound_excerpt ? `\nThey asked: ${draft.inbound_excerpt}` : '',
    `\n"${draft.body}"`,
    `\nHeld: ${triggerLine(draft.reasons ?? [])}`,
    `\nSend, edit or take it over: ${url}`,
    `\nNothing goes out until you decide.`,
  ]
  return lines.filter(Boolean).join('\n')
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
