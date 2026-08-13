'use client'

import { Send, Bot, User, Zap, AlertCircle, Mic, MicOff, Phone, PhoneOff, MessageSquare, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-hairline bg-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-bold text-ink flex items-center gap-2">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-[#5B6CF0] flex-shrink-0" />
              <span className="truncate">Test AI Employee</span>
            </h1>
            <p className="text-xs sm:text-sm text-subtle mt-0.5">
              {mode === 'chat' ? 'Send messages to test your AI' : 'Simulate a phone call'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mode toggle */}
            <div className="flex gap-1 bg-sunken rounded-lg p-1">
              <button
                onClick={() => { setMode('chat'); endCall() }}
                className={cn('relative flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors before:content-[\'\'] before:absolute before:-inset-2', mode === 'chat' ? 'bg-white text-ink shadow-sm' : 'text-subtle hover:text-ink')}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Chat</span>
              </button>
              <button
                onClick={() => { setMode('voice'); reset() }}
                className={cn('relative flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors before:content-[\'\'] before:absolute before:-inset-2', mode === 'voice' ? 'bg-white text-ink shadow-sm' : 'text-subtle hover:text-ink')}
              >
                <Phone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Voice</span>
              </button>
            </div>
            {mode === 'chat' && messages.length > 0 && (
              <Button variant="outline" size="sm" onClick={reset}>
                <RotateCcw className="w-3.5 h-3.5 sm:hidden" />
                <span className="hidden sm:inline">New</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Voice Call UI */}
      {mode === 'voice' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-8">
          {!callActive ? (
            <div className="text-center">
              <div className="w-24 h-24 rounded-full bg-[#5B6CF0]/10 flex items-center justify-center mx-auto mb-6">
                <Bot className="w-12 h-12 text-[#5B6CF0]" />
              </div>
              <h2 className="text-xl font-bold text-ink mb-2">Simulate a Phone Call</h2>
              <p className="text-subtle text-sm mb-8">Your AI employee will greet you and respond to your voice</p>
              <button
                onClick={startCall}
                className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center mx-auto shadow-lg transition-transform hover:scale-105"
              >
                <Phone className="w-8 h-8" />
              </button>
              <p className="text-sm text-muted mt-4">Tap to start call</p>
            </div>
          ) : (
            <div className="text-center">
              {/* Call status */}
              <div className="relative w-28 h-28 mx-auto mb-6">
                <div className={cn('w-28 h-28 rounded-full flex items-center justify-center', speaking ? 'bg-[#5B6CF0]' : listening ? 'bg-blue-500' : 'bg-hairline-strong')}>
                  <Bot className="w-14 h-14 text-white" />
                </div>
                {(speaking || listening) && (
                  <div className={cn('absolute inset-0 rounded-full animate-ping opacity-25', speaking ? 'bg-[#5B6CF0]' : 'bg-blue-500')} />
                )}
              </div>

              <p className="text-lg font-semibold text-ink mb-1">
                {speaking ? 'AI is speaking...' : listening ? 'Listening...' : loading ? 'Thinking...' : 'Call in progress'}
              </p>

              {transcript && (
                <p className="text-sm text-subtle italic mb-2">"{transcript}"</p>
              )}

              {/* Conversation log */}
              {messages.length > 0 && (
                <div className="max-w-md mx-auto mt-4 max-h-40 overflow-auto space-y-2 text-left">
                  {messages.slice(-4).map((msg, i) => (
                    <div key={i} className={cn('text-xs px-3 py-2 rounded-lg', msg.role === 'assistant' ? 'bg-[#5B6CF0]/10 text-ink' : 'bg-sunken text-subtle text-right')}>
                      {msg.content.length > 120 ? msg.content.slice(0, 120) + '...' : msg.content}
                    </div>
                  ))}
                </div>
              )}

              {/* End call */}
              <button
                onClick={endCall}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center mx-auto mt-8 shadow-lg transition-transform hover:scale-105"
              >
                <PhoneOff className="w-7 h-7" />
              </button>
              <p className="text-sm text-muted mt-3">Tap to end call</p>

              {/* Manual mic button when not auto-listening */}
              {!listening && !speaking && !loading && callActive && (
                <button
                  onClick={startListening}
                  className="mt-4 flex items-center gap-2 px-4 py-3 bg-blue-50 text-blue-600 rounded-full text-sm hover:bg-blue-100 mx-auto"
                >
                  <Mic className="w-4 h-4" /> Tap to speak
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat UI */}
      {mode === 'chat' && (
        <>
          <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted space-y-3">
                <Bot className="w-14 h-14 text-[#5B6CF0]/30" />
                <div className="text-center">
                  <p className="text-sm font-medium text-subtle">Chat with your AI Employee</p>
                  <p className="text-xs mt-1">Try: "I need to book an AC service"</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 w-full max-w-md">
                  {['I need to schedule an appointment', 'My AC is making a loud noise', 'How much does a furnace tune-up cost?', 'I have a gas leak emergency!'].map(s => (
                    <button key={s} onClick={() => setInput(s)} className="text-left px-3 py-3.5 text-xs text-subtle bg-sunken hover:bg-sunken rounded-lg border border-hairline transition-colors">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'assistant' ? 'bg-[#5B6CF0]/10 text-[#5B6CF0]' : 'bg-[#1a1f36] text-white'}`}>
                  {msg.role === 'assistant' ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'assistant' ? 'bg-white border border-hairline text-ink shadow-sm' : 'bg-[#1a1f36] text-white'}`}>
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-[#5B6CF0]/10 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-[#5B6CF0]" />
                </div>
                <div className="bg-white border border-hairline rounded-2xl px-4 py-3 shadow-sm">
                  <div className="flex gap-1 items-center">
                    <span className="w-2 h-2 bg-[#5B6CF0] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-[#5B6CF0] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-[#5B6CF0] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="px-3 sm:px-4 py-3 border-t border-hairline bg-white">
            <form onSubmit={handleChatSubmit} className="flex gap-2">
              <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message as a customer..." disabled={loading} className="flex-1 h-11" />
              <Button type="submit" disabled={loading || !input.trim()} className="h-11 w-11 p-0 flex-shrink-0">
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
