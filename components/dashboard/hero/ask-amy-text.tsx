'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import { ArrowUp, AudioLines } from 'lucide-react'
import { type AmyBriefing, TTS_VOICE } from './ask-amy-shared'

// Typed fallback for Ask Amy. Realtime voice is the primary experience; this is the
// quiet "Type instead" path. Streams the reply and speaks it in her real voice.
export function AskAmyText({ briefing, onTalk }: { briefing: AmyBriefing; onTalk: () => void }) {
  const name = briefing.employeeName || 'Amy'
  const [input, setInput] = useState('')
  const [question, setQuestion] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const unlockedRef = useRef(false)

  function unlock() {
    if (unlockedRef.current) return
    const a = audioRef.current || (audioRef.current = new Audio())
    try { a.muted = true; a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; a.play().then(() => { a.pause(); a.muted = false; unlockedRef.current = true }).catch(() => { a.muted = false }) } catch { /* noop */ }
  }

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    unlock()
    setInput(''); setQuestion(q); setAnswer(''); setBusy(true)
    try {
      // Chief-of-Staff path: Amy retrieves THIS business's real data before answering.
      const res = await fetch('/api/ai/amy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q }),
      })
      if (!res.ok || !res.body) throw new Error()
      const reader = res.body.getReader(); const dec = new TextDecoder(); let acc = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setAnswer(acc) }
      if (acc.trim()) {
        const a = audioRef.current || (audioRef.current = new Audio())
        a.src = `/api/tts?voice=${encodeURIComponent(TTS_VOICE(briefing.employeeVoice))}&text=${encodeURIComponent(acc.trim())}`
        a.play().catch(() => {})
      }
    } catch {
      setAnswer(`I couldn't reach my notes just now — give me a moment and ask again.`)
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto w-full max-w-md text-left">
      {question !== null && (
        <div className="relative mb-3">
          <div aria-hidden="true" className="pointer-events-none absolute -inset-3 rounded-[32px] bg-accent/10 blur-2xl opacity-70" />
          <div key={question} className="relative rounded-3xl bg-white ring-1 ring-hairline shadow-e3 px-6 py-5 sx-animate-in">
            <div className="mb-2 flex items-center gap-2.5">
              <EmployeeAvatar name={name} voice={briefing.employeeVoice} status="on_duty" size="sm" />
              <span className="text-sm font-medium text-ink">{name}</span>
            </div>
            <p className="text-[15px] font-light leading-relaxed text-ink">{answer || '…'}</p>
          </div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Type to ${name}…`}
          className="h-11 flex-1 rounded-full bg-sunken px-4 text-sm text-ink placeholder:text-muted outline-none transition-shadow focus:shadow-[0_0_0_4px_rgba(91,108,240,0.10)]"
        />
        <button type="submit" aria-label="Send" disabled={!input.trim() || busy} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-ink text-white transition-all hover:bg-ink/90 active:scale-95 disabled:opacity-40">
          <ArrowUp className="h-[18px] w-[18px]" />
        </button>
      </form>

      <button onClick={onTalk} className={cn('mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent-strong hover:underline')}>
        <AudioLines className="h-3.5 w-3.5" /> Talk to {name} instead
      </button>
    </div>
  )
}
