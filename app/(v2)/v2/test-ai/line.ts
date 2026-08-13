import type { RudiSegment } from '../rudi-line'

export interface TestAiLineInput {
  /** Messages exchanged in this sandbox session. */
  exchanges: number
  busy: boolean
  error: string
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The accent is the only thing here a person acts on: an error, or the invitation to start. Once a
// conversation is running the line steps back and reports, because the thread is the screen.
export function testAiLine({ exchanges, busy, error }: TestAiLineInput): RudiSegment[] {
  if (error) return [{ text: 'Something went wrong. ' }, { text: error, accent: true }]
  if (busy) return [{ text: 'Rudi is thinking…' }]
  if (exchanges === 0) {
    return [
      { text: 'This is a sandbox — it talks to your own agent and changes nothing. ' },
      { text: 'Say something and see how Rudi answers.', accent: true },
    ]
  }
  return [{ text: `${exchanges} ${plural(exchanges, 'message', 'messages')} so far. Nothing here reaches a customer.` }]
}
