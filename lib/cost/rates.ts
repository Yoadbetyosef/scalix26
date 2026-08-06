// Cost rates (USD). Usage (tokens, seconds, segments) is measured EXACTLY; these unit prices
// are provider list rates — update them if your contract differs so the numbers reflect real
// spend.
//
// Sources (verified Jul 2026):
//   • Anthropic API — platform.claude.com/docs/en/about-claude/pricing
//   • Deepgram — deepgram.com/pricing (Voice Agent, Pay As You Go)
//   • Twilio — twilio.com/en-us/{sms,voice}/pricing/us

export interface LlmRate { inputPerM: number; outputPerM: number } // $ per 1M tokens

export const LLM_RATES: Record<string, LlmRate> = {
  'claude-haiku-4-5': { inputPerM: 1.0, outputPerM: 5.0 }, // the model this app uses
  // Supplier-invoice extraction (lib/invoices/extract.ts) — the one path where a misread digit becomes
  // a wrong cost, becomes a wrong price, and nobody finds out. List rates, deliberately: Anthropic's
  // introductory $2/$10 runs to 2026-08-31, and a table that expires silently would UNDER-report spend
  // from September. Over-reporting by a third on a handful of invoices a month is the safe direction.
  'claude-sonnet-5': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-sonnet-4-6': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-opus-4-8': { inputPerM: 5.0, outputPerM: 25.0 },
}
// The fallback is Haiku's rate, which is the CHEAPEST row in this table — so an unlisted model is
// under-reported, not over. Adding a model without adding its row here is therefore silent revenue
// leakage rather than a visible error. Add the row in the same change as the model.
export const DEFAULT_LLM_RATE: LlmRate = { inputPerM: 1.0, outputPerM: 5.0 } // Haiku 4.5

export function llmCost(model: string, inputTokens: number, outputTokens: number): number {
  const r = LLM_RATES[model] || DEFAULT_LLM_RATE
  return (inputTokens / 1e6) * r.inputPerM + (outputTokens / 1e6) * r.outputPerM
}

// Infrastructure unit rates.
export const RATE_DEEPGRAM_VOICE_PER_MIN = 0.075 // Deepgram Voice Agent (Standard, PAYG), blended STT+TTS
export const RATE_TWILIO_SMS_PER_SEGMENT = 0.0083 // Twilio US SMS, per segment
export const RATE_TWILIO_VOICE_PER_MIN = 0.0085 // Twilio US local inbound voice (AI receives calls)

// Voice LLM (Anthropic BYO inside the Deepgram Voice Agent). Deepgram bills by TIME and does
// NOT report these tokens. This rate is DERIVED FROM REAL DATA: measuring token usage across
// 2,152 stored voice-transcript messages (98 conversations) at Claude Haiku 4.5 rates gave
// ~$1.38 of LLM cost over ~116–146 real voice minutes → ≈ $0.011/min. Re-derive if your call
// mix changes, or replace with exact per-token logging (voice-LLM proxy) if you add it.
export const RATE_VOICE_LLM_PER_MIN = 0.011

// Transactional email (Resend), per message. Placeholder list rate — mirror your contract.
export const RATE_RESEND_EMAIL = 0.001
// Blended voice minute (Twilio inbound + Deepgram voice agent + voice-LLM) — what the voice meter bills.
export const RATE_VOICE_PER_MIN = RATE_TWILIO_VOICE_PER_MIN + RATE_DEEPGRAM_VOICE_PER_MIN + RATE_VOICE_LLM_PER_MIN
