'use client'

import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'

interface Msg { role: 'user' | 'assistant'; content: string }

export function DemoChat({ slug, greeting, accent }: { slug: string; greeting: string; accent: string }) {
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', content: greeting }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next); setInput(''); setBusy(true)
    try {
      const res = await fetch(`/api/demos/${slug}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next }) })
      const j = await res.json()
      setMessages((m) => [...m, { role: 'assistant', content: j.reply || '…' }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    } finally { setBusy(false) }
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-hairline bg-surface shadow-e2">
      <div ref={scrollRef} className="h-[420px] space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.role === 'user' ? 'text-white' : 'bg-sunken text-ink'}`}
              style={m.role === 'user' ? { background: accent } : undefined}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl bg-sunken px-3.5 py-2 text-sm text-muted">Typing…</div></div>}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-hairline p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" disabled={busy}
          className="h-11 flex-1 rounded-xl border border-hairline-strong bg-white px-3.5 text-sm outline-none focus:border-accent" />
        <button type="submit" disabled={busy || !input.trim()} className="flex h-11 w-11 items-center justify-center rounded-xl text-white disabled:opacity-40" style={{ background: accent }}>
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
