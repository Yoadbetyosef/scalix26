'use client'

import { Send, AlertCircle, Mic, Phone, PhoneOff, RotateCcw } from 'lucide-react'
import { RobotAvatar } from '@/components/brand/robot-avatar'
import { useTestAi } from '@/lib/test-ai/use-test-ai'

// The sandbox. It talks to /api/ai/test and /api/ai/speak against this tenant's own agent and touches
// no customer record, which is why /v2's copy of this screen is live rather than read-only: there is
// nothing here for read-only to protect.
export default function TestAIPage() {
  // Moved to lib/test-ai/use-test-ai.ts so /v2's Test AI drives the SAME machine. Every state
  // declaration, both handlers and the voice refs went with it — nothing stayed behind. What differs
  // between the surfaces is only what each one renders.
  const {
    messages, input, setInput, loading, error, mode, setMode,
    callActive, listening, speaking, transcript, bottomRef,
    startListening, startCall, endCall, handleChatSubmit, reset,
  } = useTestAi()

  return (
    <div className="v2 v2-embedded flex flex-col h-full">
      {/* No page title beyond what the rail says. The two modes are the approved tabs; the state
          line under them says which one you are in and what it does. */}
      <div className="p-4 sm:p-6 border-b border-hairline flex-shrink-0">
        <div className="v2-tabs">
          <button onClick={() => { setMode('chat'); endCall() }} className="v2-tab" data-on={mode === 'chat' || undefined}>
            Chat
          </button>
          <button onClick={() => { setMode('voice'); reset() }} className="v2-tab" data-on={mode === 'voice' || undefined}>
            Voice
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ paddingBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="v2-kick" style={{ marginBottom: 0 }}>
              {mode === 'chat' ? 'Send messages as a customer' : 'Simulate a phone call'}
            </span>
            {mode === 'chat' && messages.length > 0 && (
              <button onClick={reset} className="v2-act tap-target"><RotateCcw className="w-3.5 h-3.5" /> New</button>
            )}
          </span>
        </div>
      </div>

      {/* VOICE. THE ONE FACE — v1 drew a lucide robot glyph in a tinted disc, which is a third
          depiction of the employee on a screen whose whole subject is that employee. The dome is the
          same one the dashboard hero, the inbox rows and the employee list already show, and the
          state is said by the ring around it rather than by swapping its colour. */}
      {mode === 'voice' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-8 p-6">
          {!callActive ? (
            <div className="text-center">
              <span className="v2-tface" style={{ margin: '0 auto 22px' }}><RobotAvatar size={96} /></span>
              <p className="v2-kick" style={{ justifyContent: 'center', ['--ghue' as string]: 'var(--v2-t1)' }}><i />Simulate a phone call</p>
              <p className="v2-hint" style={{ maxWidth: '38ch', margin: '0 auto 26px' }}>
                Your AI employee greets you and answers out loud, exactly as it would a customer.
              </p>
              <button onClick={startCall} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
                <Phone className="w-3.5 h-3.5" /> Start the call
              </button>
            </div>
          ) : (
            <div className="text-center" style={{ maxWidth: 460, width: '100%' }}>
              <span className="v2-tface" data-state={speaking ? 'speaking' : listening ? 'listening' : undefined} style={{ margin: '0 auto 20px' }}>
                <RobotAvatar size={112} />
              </span>

              <p className="v2-kick" style={{ justifyContent: 'center', ['--ghue' as string]: speaking ? 'var(--v2-t1)' : listening ? 'var(--v2-live)' : 'var(--v2-mute)' }}>
                <i />{speaking ? 'Speaking' : listening ? 'Listening' : loading ? 'Thinking' : 'Call in progress'}
              </p>

              {transcript && <p className="v2-quote" style={{ ['--chan' as string]: 'var(--v2-live)', textAlign: 'left', marginBottom: 16 }}>“{transcript}”</p>}

              {/* The last few turns, in the same bubbles the inbox uses. */}
              {messages.length > 0 && (
                <div className="v2-thread" style={{ maxHeight: 176, overflow: 'auto', margin: '18px 0', textAlign: 'left' }}>
                  {messages.slice(-4).map((msg, i) => (
                    <div key={i} className="v2-bub" data-who={msg.role === 'assistant' ? 'us' : 'them'}>
                      {msg.content.length > 120 ? msg.content.slice(0, 120) + '…' : msg.content}
                    </div>
                  ))}
                </div>
              )}

              <div className="v2-bar" style={{ justifyContent: 'center', marginTop: 22 }}>
                {/* Manual mic when the call is not auto-listening. */}
                {!listening && !speaking && !loading && (
                  <button onClick={startListening} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
                    <Mic className="w-3.5 h-3.5" /> Tap to speak
                  </button>
                )}
                <button onClick={endCall} className="v2-act tap-target" data-solid data-danger>
                  <PhoneOff className="w-3.5 h-3.5" /> End the call
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chat */}
      {mode === 'chat' && (
        <>
          <div className="flex-1 overflow-auto p-4 sm:p-6">
            {messages.length === 0 && (
              <div style={{ maxWidth: 520, margin: '0 auto' }}>
                <div className="v2-card" data-empty style={{ marginBottom: 18 }}>
                  <b>Chat with your AI employee</b>
                  <span>Type as a customer would. Nothing here reaches a real person, and nothing is saved to your inbox.</span>
                </div>
                {/* The four openers, as chips rather than four bordered boxes — they fill the field,
                    they do not send, so they are suggestions and should look like it. */}
                <p className="v2-kick">Try one</p>
                <div className="flex flex-wrap gap-2">
                  {['I need to schedule an appointment', 'My AC is making a loud noise', 'How much does a furnace tune-up cost?', 'I have a gas leak emergency!'].map(sug => (
                    <button key={sug} onClick={() => setInput(sug)} className="v2-chip">{sug}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.length > 0 && (
              <div className="v2-thread">
                {messages.map((msg, i) => (
                  <div key={i} className="v2-bub" data-who={msg.role === 'assistant' ? 'us' : 'them'}>
                    {msg.content}
                  </div>
                ))}
                {loading && (
                  <div className="v2-bub" data-who="us" aria-live="polite">
                    <span className="v2-typing"><i /><i /><i /></span>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)', marginTop: 18 }}>
                <span className="v2-chip-sq"><AlertCircle /></span>
                <p>{error}</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* The same composer /inbox uses: a rule, not a box, with the label saying who it reaches. */}
          <div className="px-4 sm:px-6 py-3 border-t border-hairline flex-shrink-0">
            <form onSubmit={handleChatSubmit} className="flex items-end gap-3">
              <div className="v2-fld flex-1">
                <label htmlFor="test-msg">Say something as a customer</label>
                <input
                  id="test-msg" value={input} onChange={e => setInput(e.target.value)}
                  placeholder="Type a message…" disabled={loading} autoComplete="off"
                />
              </div>
              <button type="submit" className="v2-act" disabled={loading || !input.trim()}
                      style={{ ['--ghue' as string]: 'var(--v2-t1)', paddingBottom: 9, paddingTop: 9 }}>
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
