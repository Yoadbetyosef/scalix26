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
