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
// It drives the SAME hook as /test-ai, and now renders both of its surfaces. Voice is rendering only:
// callActive, listening, speaking, transcript, startCall, endCall and startListening all come from the
// hook exactly as they are. No handler, no state and no effect was added here — if this file ever
// needs one, the machine has leaked out of the hook and that is the bug.

export function TestAiClient() {
  const {
    messages, input, setInput, loading, error, handleChatSubmit, reset, bottomRef,
    mode, setMode, callActive, listening, speaking, transcript, startCall, endCall, startListening,
  } = useTestAi()

  // What the call is doing, in the caller's own words. Only one of these is ever true, and the order
  // matters: speaking wins over listening because her audio ends the turn.
  const callState = speaking ? 'Rudi is speaking' : listening ? 'Listening' : loading ? 'Thinking' : 'Your turn'

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
        {/* Chat or call. One control, and it swaps which surface is live — never both at once, so the
            single accent below always belongs to whichever mode is showing. endCall() on the way out
            of voice is the hook's own teardown, not a local one. */}
        <div className="v2-chips" style={{ marginBottom: 18 }}>
          {(['chat', 'voice'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="v2-chip"
              data-on={mode === m || undefined}
              onClick={() => { setMode(m); if (m === 'chat') endCall() }}
            >
              {m === 'chat' ? 'Chat' : 'Call'}
            </button>
          ))}
        </div>

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
          emptyLabel={mode === 'voice' ? 'Start the call and say something.' : 'Nothing said yet.'}
          composer={mode === 'voice' ? (
            <div className="v2-call">
              {/* What she is hearing, as it arrives. It clears itself when the phrase is final, so an
                  empty transcript is not an error state and draws nothing. */}
              {transcript && <p className="v2-tscript">“{transcript}”</p>}

              <div className="v2-callbar">
                <span className="v2-callstate" data-on={callActive || undefined}>
                  <i data-live={(listening || speaking) || undefined} />
                  {callActive ? callState : 'Not on a call'}
                </span>

                {!callActive ? (
                  <button type="button" className="v2-ract" data-tone="primary" onClick={startCall}>Start call</button>
                ) : (
                  <>
                    {/* The hook exposes this for exactly the moment a turn ends without her hearing
                        anything — v1 renders the same button under the same condition. */}
                    {!listening && !speaking && !loading && (
                      <button type="button" className="v2-ract" onClick={startListening}>Speak</button>
                    )}
                    <button type="button" className="v2-ract" onClick={endCall}>End call</button>
                  </>
                )}
              </div>
            </div>
          ) : (
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
          )}
        />
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
