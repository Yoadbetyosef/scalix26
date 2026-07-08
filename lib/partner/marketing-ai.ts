import { anthropic } from '@/lib/anthropic/client'

// AI Creative Studio + Landing optimization backend. Language-only work (per the deterministic-first
// architecture, the AI never computes money/counts). Hybrid model routing: cheap Haiku for quick
// transforms, Sonnet for deep reasoning (analyze / long-form). Bounded max_tokens keep cost sane.

const HAIKU = 'claude-haiku-4-5'
const SONNET = 'claude-sonnet-4-6'

const BRAND = `Scalix26 is an AI employee for local/service businesses: it learns the business, answers every call, text and message 24/7, captures and follows up on every lead, books appointments, recommends the next best action, and protects revenue. Position it as an "AI employee" / "operating system for your business" — never a "chatbot" or "just an answering service". Voice: confident, concrete, benefit-led, no hype, no emoji.`

export interface CreativeCtx { type: string; title: string; text: string; platform?: string }

// action key → { label, model, deep }
export const CREATIVE_ACTIONS: Record<string, { label: string; model: string }> = {
  improve_copy: { label: 'Improve copy', model: HAIKU },
  shorten: { label: 'Shorten', model: HAIKU },
  expand: { label: 'Expand', model: SONNET },
  variations: { label: 'Generate 5 variations', model: HAIKU },
  facebook: { label: 'Facebook version', model: HAIKU },
  instagram: { label: 'Instagram version', model: HAIKU },
  google_search: { label: 'Google Search version', model: HAIKU },
  display: { label: 'Display ad version', model: HAIKU },
  email: { label: 'Email version', model: HAIKU },
  sms: { label: 'SMS version', model: HAIKU },
  cold_dm: { label: 'Cold DM', model: HAIKU },
  video_script: { label: 'Video script', model: SONNET },
  voice_script: { label: 'Voice script', model: SONNET },
  improve_cta: { label: 'Improve CTA', model: HAIKU },
  improve_headline: { label: 'Improve headline (10)', model: HAIKU },
  analyze: { label: 'Analyze conversion potential', model: SONNET },
}

const CREATIVE_PROMPTS: Record<string, string> = {
  improve_copy: 'Rewrite the creative below to increase conversions. Keep it the same format and length. Return only the rewritten copy.',
  shorten: 'Rewrite the creative below as a tighter, shorter version suitable for an ad or SMS. Return only the short version.',
  expand: 'Expand the creative below into a longer, richer landing-page-ready version with a hook, 3 benefit points, and a strong close. Return only the expanded copy.',
  variations: 'Write 5 distinct high-converting variations of the creative below, each a different angle (fear of loss, time saved, proof, speed, growth). Number them 1–5. Return only the list.',
  facebook: 'Rewrite the creative below as a Facebook ad: a scroll-stopping primary text plus a short headline and a CTA. Label the parts. Return only the ad.',
  instagram: 'Rewrite the creative below as an Instagram ad: punchy caption, a few relevant hashtags, and a CTA. Return only the ad.',
  google_search: 'Turn the creative below into a Google Search ad: 5 headlines (max 30 chars each) and 3 descriptions (max 90 chars each). Label them. Return only the ad.',
  display: 'Turn the creative below into display-ad banner copy: a 3–5 word headline, a one-line subhead, and a 2–3 word button. Return only the copy.',
  email: 'Turn the creative below into a short marketing email: subject line, preview text, and a 3-paragraph body with a CTA. Label the parts. Return only the email.',
  sms: 'Turn the creative below into a single, friendly follow-up SMS under 160 characters. Return only the text.',
  cold_dm: 'Turn the creative below into a short, personable cold DM for outreach (LinkedIn/Instagram). No links, ask a soft question. Return only the message.',
  video_script: 'Turn the creative below into a 30–45 second talking-head video script: hook, problem, solution, proof, CTA. Use short spoken lines. Return only the script.',
  voice_script: 'Turn the creative below into a natural phone/voice-AI script: a warm opener, the core value, a qualifying question, and a booking close. Return only the script.',
  improve_cta: 'Suggest 6 stronger calls-to-action for the creative below, ordered strongest first. Return only the list.',
  improve_headline: 'Write 10 better headlines for the creative below, punchy and specific. Number them 1–10. Return only the list.',
  analyze: 'Analyze the creative below for conversion potential. In under 150 words, give: what works, what is weak, the single highest-impact change, and a 1–10 score with one line of reasoning. Be direct and specific.',
}

const LANDING_ACTIONS: Record<string, { label: string; model: string }> = {
  improve_headline: { label: 'Improve headline', model: HAIKU },
  improve_hero: { label: 'Improve hero section', model: HAIKU },
  improve_cta: { label: 'Improve CTA', model: HAIKU },
  improve_seo: { label: 'Improve SEO', model: SONNET },
  local_seo: { label: 'Improve local SEO', model: SONNET },
  faq: { label: 'Generate FAQ', model: HAIKU },
  social_proof: { label: 'Add social proof', model: HAIKU },
  trust: { label: 'Improve trust signals', model: HAIKU },
  mobile: { label: 'Improve mobile conversion', model: SONNET },
  analyze: { label: 'Analyze conversion rate', model: SONNET },
}

const LANDING_PROMPTS: Record<string, string> = {
  improve_headline: 'Write 6 stronger hero headlines for the landing page below. Number them. Return only the list.',
  improve_hero: 'Rewrite the hero section (headline + subheadline) of the landing page below to convert better. Label Headline and Subheadline. Return only that.',
  improve_cta: 'Suggest 6 stronger CTA button labels for the landing page below, strongest first. Return only the list.',
  improve_seo: 'Suggest SEO improvements for the landing page below: a title tag, meta description, and 5 target keywords. Label them. Return only that.',
  local_seo: 'Suggest local-SEO improvements for the landing page below for a local service business: how to work in city/service terms, a Google Business Profile tip, and 5 local keywords. Return only that.',
  faq: 'Write a 5-question FAQ section for the landing page below that removes buying objections. Q/A format. Return only the FAQ.',
  social_proof: 'Write 3 short, believable testimonial-style social-proof lines and one stat line for the landing page below. Return only those.',
  trust: 'List 6 trust signals to add to the landing page below (badges, guarantees, specifics) and where to place each. Return only the list.',
  mobile: 'Give 6 specific changes to improve mobile conversion for the landing page below (above-the-fold, tap targets, length, CTA). Return only the list.',
  analyze: 'Analyze the landing page below for conversion. In under 150 words: what is weak, what to change, why, and the expected impact. Give a 1–10 score. Be direct.',
}

async function call(model: string, system: string, user: string, maxTokens: number): Promise<string> {
  try {
    const r = await anthropic.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
    return r.content[0]?.type === 'text' ? r.content[0].text.trim() : ''
  } catch {
    const r = await anthropic.messages.create({ model: HAIKU, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
    return r.content[0]?.type === 'text' ? r.content[0].text.trim() : ''
  }
}

export async function runCreativeAction(action: string, c: CreativeCtx): Promise<string> {
  const cfg = CREATIVE_ACTIONS[action]; const prompt = CREATIVE_PROMPTS[action]
  if (!cfg || !prompt) throw new Error('Unknown action')
  const system = `${BRAND}\n\nYou are a senior direct-response marketer helping a Scalix26 partner. Follow the instruction exactly and return only the requested output — no preamble, no markdown headers unless asked.`
  const user = `Instruction: ${prompt}\n\nCreative type: ${c.type}${c.platform ? ` (platform: ${c.platform})` : ''}\nTitle: ${c.title}\n---\n${c.text || '(no content yet)'}\n---`
  const maxTokens = action === 'expand' || action === 'video_script' || action === 'voice_script' ? 1200 : 700
  return call(cfg.model, system, user, maxTokens)
}

export async function runLandingAction(action: string, page: { headline: string; subhead?: string | null; cta_text: string; extra?: string }): Promise<string> {
  const cfg = LANDING_ACTIONS[action]; const prompt = LANDING_PROMPTS[action]
  if (!cfg || !prompt) throw new Error('Unknown action')
  const system = `${BRAND}\n\nYou are a landing-page conversion expert helping a Scalix26 partner. Follow the instruction exactly and return only the requested output.`
  const user = `Instruction: ${prompt}\n\nLanding page —\nHeadline: ${page.headline}\nSubheadline: ${page.subhead || '(none)'}\nCTA: ${page.cta_text}${page.extra ? `\n${page.extra}` : ''}`
  return call(cfg.model, system, user, 900)
}

export const creativeActionList = () => Object.entries(CREATIVE_ACTIONS).map(([key, v]) => ({ key, label: v.label }))
export const landingActionList = () => Object.entries(LANDING_ACTIONS).map(([key, v]) => ({ key, label: v.label }))
