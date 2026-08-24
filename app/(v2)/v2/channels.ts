// NO 'use client' — DELIBERATELY, AND THIS FILE EXISTS BECAUSE OF IT.
//
// These lived in list.tsx, which is a client module. A Server Component importing from one does not
// receive the real exports: it receives CLIENT REFERENCE PROXIES. Rendering them as components works;
// CALLING a plain function export on the server does not — the proxy is not a function, and invoking
// it throws inside the Server Components render, where production strips the message and leaves a
// digest. Four list routes called channelKey() on the server and every one of them went down.
//
// Nothing catches this. tsc sees an ordinary function export and next build compiles it; the rule is
// enforced at runtime, on the server, only when the proxy is invoked. A green build was not evidence
// that the code ran.
//
// So the mapping lives in a plain module that both sides may import: the routes call it on the server,
// list.tsx renders from it on the client.

// The channels the product actually has. A row's mark is the same shape and weight for every one of
// them; only the hue differs, so a column of rows sorts by channel at a glance.
export type ChannelKey = 'voice' | 'sms' | 'email' | 'facebook' | 'instagram' | 'web'

const CHANNEL_ALIASES: Record<string, ChannelKey> = {
  voice: 'voice', phone: 'voice', call: 'voice',
  sms: 'sms', text: 'sms', whatsapp: 'sms',
  email: 'email', mail: 'email',
  facebook: 'facebook', messenger: 'facebook',
  instagram: 'instagram',
  web: 'web', chat: 'web', web_form: 'web', webchat: 'web',
}

/** Maps whatever a row's source column says onto a mark. Unknown stays unmarked rather than guessing. */
export const channelKey = (v: string | null | undefined): ChannelKey | null =>
  (v ? CHANNEL_ALIASES[v.toLowerCase().trim()] ?? null : null)

/** How a channel is written when it is shown as a word. The mark carries the hue; this carries the name. */
export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  voice: 'Voice', sms: 'SMS', email: 'Email',
  facebook: 'Facebook', instagram: 'Instagram', web: 'Web chat',
}

/**
 * THE HUE A CHANNEL WEARS — the one table in the app that decides it.
 *
 * It lived in three places by the time /contacts was migrated: a local const in app/inbox/page.tsx,
 * another in components/inbox/conversation-contact-panel.tsx, and /contacts importing the second
 * one. That import is what exposed the duplication, and it did it the way this file's header warns
 * about: conversation-contact-panel.tsx is a client module, so a Server Component importing a plain
 * object from it receives a CLIENT REFERENCE PROXY. `CHANNEL_HUE['sms']` was `undefined`, every chip
 * silently fell back to --v2-t1, and a contacts table where every channel is the same pink is what
 * it looked like. tsc had nothing to say; the build was green.
 *
 * Keyed by ChannelKey rather than by the raw column, so `whatsapp` gets sms's hue and `phone` gets
 * voice's instead of each caller keeping its own alias list.
 */
export const CHANNEL_HUE: Record<ChannelKey, string> = {
  voice: 'var(--v2-t4)',
  sms: 'var(--v2-t2)',
  email: 'var(--v2-t3)',
  facebook: 'var(--v2-t3)',
  instagram: 'var(--v2-t1)',
  web: 'var(--v2-t1)',
}

/** The hue for whatever a row's source column says. Unknown falls back to the first tint. */
export const channelHue = (v: string | null | undefined): string => {
  const k = channelKey(v)
  return k ? CHANNEL_HUE[k] : 'var(--v2-t1)'
}
