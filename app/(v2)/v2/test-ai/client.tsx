'use client'

import { useTestAi } from '@/lib/test-ai/use-test-ai'
import { ThreadView, type ThreadMessage } from '../thread'
import { testAiLine } from './line'

// TEST AI — the one live screen in /v2.
//
// It is exempt from read-only because it is a sandbox: the same /api/ai/test and /api/ai/speak the
// existing page calls, against this tenant's own agent, touching no customer record. There is nothing
// here for read-only to protect.
//
// It drives the SAME hook as /test-ai. What differs is only what is rendered: this surface shows the
// conversation and does not surface callActive, listening, speaking or transcript. Voice on /v2 is a
// later task, not a half-wired one.

export function TestAiClient() {
  const { messages, input, setInput, loading, error, handleChatSubmit, reset, bottomRef } = useTestAi()

  const thread: ThreadMessage[] = messages.map((m, i) => ({
    id: `${i}`,
    side: m.role === 'assistant' ? 'them' : 'us',
    body: m.content,
    // The sandbox keeps no timestamps, so every message carries the same one and the thread draws no
    // day divider. Inventing times to fill the slot would be worse than having none.
    at: new Date().toISOString(),
    byAi: m.role === 'assistant',
  }))

  return (
    <div className="v2-page">
      <header className="v2-phd">
        <a href="/v2" className="v2-bk" aria-label="Home">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </a>
        <h2>Test AI</h2>
      </header>

      <div className="v2-pbody" data-scroll>
        <p className="v2-lin">
          {testAiLine({ exchanges: messages.length, busy: loading, error })
            .map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
        </p>

        {messages.length > 0 && (
          <div className="v2-dacts">
            <button type="button" className="v2-ract" onClick={reset}>Start over</button>
          </div>
        )}

        <ThreadView
          messages={thread}
          emptyLabel="Nothing said yet."
          composer={
            <form onSubmit={handleChatSubmit} className="v2-tform">
              <input
                className="v2-tinput"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Say something to Rudi…"
                aria-label="Message"
              />
              <button type="submit" className="v2-ract" data-tone="primary" disabled={loading || !input.trim()}>
                {loading ? 'Sending…' : 'Send'}
              </button>
            </form>
          }
        />
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
