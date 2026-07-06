// Cost rates (USD). Usage (tokens, seconds, segments) is measured EXACTLY; these unit prices
// are your provider-contract rates — update them to match your actual pricing so the numbers
// reflect real spend.

export interface LlmRate { inputPerM: number; outputPerM: number } // $ per 1M tokens

export const LLM_RATES: Record<string, LlmRate> = {
  'claude-haiku-4-5': { inputPerM: 1.0, outputPerM: 5.0 },
  'claude-sonnet-4-6': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-opus-4-8': { inputPerM: 15.0, outputPerM: 75.0 },
}
export const DEFAULT_LLM_RATE: LlmRate = { inputPerM: 1.0, outputPerM: 5.0 }

export function llmCost(model: string, inputTokens: number, outputTokens: number): number {
  const r = LLM_RATES[model] || DEFAULT_LLM_RATE
  return (inputTokens / 1e6) * r.inputPerM + (outputTokens / 1e6) * r.outputPerM
}

// Infrastructure unit rates.
export const RATE_DEEPGRAM_VOICE_PER_MIN = 0.075 // Deepgram Voice Agent, blended STT+TTS
export const RATE_TWILIO_SMS_PER_SEGMENT = 0.0079 // Twilio US SMS
export const RATE_TWILIO_VOICE_PER_MIN = 0.014 // Twilio US voice, blended
