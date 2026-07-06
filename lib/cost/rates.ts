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
  'claude-sonnet-4-6': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-opus-4-8': { inputPerM: 5.0, outputPerM: 25.0 },
}
export const DEFAULT_LLM_RATE: LlmRate = { inputPerM: 1.0, outputPerM: 5.0 } // Haiku 4.5

export function llmCost(model: string, inputTokens: number, outputTokens: number): number {
  const r = LLM_RATES[model] || DEFAULT_LLM_RATE
  return (inputTokens / 1e6) * r.inputPerM + (outputTokens / 1e6) * r.outputPerM
}

// Infrastructure unit rates.
export const RATE_DEEPGRAM_VOICE_PER_MIN = 0.075 // Deepgram Voice Agent (Standard, PAYG), blended STT+TTS
export const RATE_TWILIO_SMS_PER_SEGMENT = 0.0083 // Twilio US SMS, per segment
export const RATE_TWILIO_VOICE_PER_MIN = 0.0085 // Twilio US local inbound voice (AI receives calls)
