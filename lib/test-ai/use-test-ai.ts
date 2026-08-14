'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// THE TEST-AI SANDBOX, AS A HOOK.
//
// Moved here VERBATIM from app/test-ai/page.tsx: every state declaration, both handlers, the whole
// voice machine and the two refs. Nothing was left behind in the page — a state machine split across
// two files is the thing this exists to prevent.
//
// What differs between the two surfaces is only what gets RENDERED. /test-ai renders the mic UI as it
// always has; /v2/test-ai renders chat and simply does not surface callActive, listening, speaking or
// transcript. Same hook, two surfaces.

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: any
  }
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type Mode = 'chat' | 'voice'

/**
 * @param agentId which employee to talk to. Absent = the tenant's default agent, which is what the
 *   sandbox has always done. Supplied, both the reply and the voice come from THAT employee — this is
 *   how Miles's panel talks to Miles rather than to whoever answers the phone.
 *
 * Deliberately an argument on the ONE state machine rather than a second hook: the turn-taking, the
 * recognition lifecycle and the audio teardown are hard-won and must not exist twice.
 */
export function useTestAi(agentId?: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [mode, setMode] = useState<Mode>('chat')
  const [callActive, setCallActive] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  /** Audio has been asked for and has not started yet. Not speaking — nothing is audible. */
  const [pending, setPending] = useState(false)
  const [transcript, setTranscript] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text: string, speak = false) {
    if (!text.trim() || loading) return
    setError('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId, agentId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Error'); return }

      setConversationId(data.conversationId)
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])

      if (speak && data.response) {
        await speakText(data.response)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function speakText(text: string) {
    // NOT set here. `speaking` used to flip true before the TTS request was even sent, so anything
    // watching it — a mouth, a meter, a pill — moved during the silence while audio was being
    // synthesised, and could be finished by the time sound actually arrived. It means what it says
    // now: audio is playing. `pending` covers the gap for anything that wants to show the wait.
    setPending(true)
    try {
      // Strip markdown bold
      const clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
      const res = await fetch('/api/ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, agentId }),
      })
      if (!res.ok) throw new Error('TTS failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      // The element itself says when sound starts and stops. Every exit clears both flags.
      audio.onplaying = () => { setPending(false); setSpeaking(true) }
      audio.onended = () => { setSpeaking(false); setPending(false); URL.revokeObjectURL(url); if (callActive) startListening() }
      audio.onerror = () => { setSpeaking(false); setPending(false); if (callActive) startListening() }
      await audio.play()
    } catch {
      setSpeaking(false)
      setPending(false)
      if (callActive) startListening()
    }
  }

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setError('Speech recognition not supported in this browser'); return }

    // ONE RECOGNISER AT A TIME. This built a new one on every call and left the old one running, so
    // two of them heard the same sentence and each sent it — one turn, two answers. abort() rather
    // than stop(): stop() delivers a final result on the way out, which would send a third time.
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* already gone */ }
      recognitionRef.current = null
    }

    const recognition = new SR()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false
    recognitionRef.current = recognition

    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)

    // One phrase, one send. A recogniser can deliver a final result and then deliver another as it
    // winds down; without this latch the same sentence is answered twice.
    let sent = false
    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1]
      const text = result[0].transcript
      setTranscript(text)
      if (result.isFinal && text.trim() && !sent) {
        sent = true
        setTranscript('')
        try { recognition.abort() } catch { /* fine */ }
        if (recognitionRef.current === recognition) recognitionRef.current = null
        sendMessage(text, true)
      }
    }

    recognition.onerror = () => setListening(false)
    recognition.start()
  }, [callActive]) // eslint-disable-line react-hooks/exhaustive-deps

  function startCall() {
    setCallActive(true)
    setMessages([])
    setConversationId(undefined)
    // AI greets first
    const greeting = "Hello! Thank you for calling. How can I help you today?"
    setMessages([{ role: 'assistant', content: greeting }])
    // NOT `.then(startListening)`. speakText resolves when play() STARTS, so that opened the
    // microphone while the greeting was still coming out of the speaker — he transcribed himself and
    // answered his own greeting. The audio element's `ended` handler is what starts listening, and it
    // is the only thing that does.
    void speakText(greeting)
  }

  function endCall() {
    setCallActive(false)
    setListening(false)
    setSpeaking(false)
    setTranscript('')
    // abort(), not stop(): stop() emits one last result, which would send a message after the call
    // the owner just ended.
    try { recognitionRef.current?.abort() } catch { /* already gone */ }
    recognitionRef.current = null
    audioRef.current?.pause()
  }

  function handleChatSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
    setInput('')
  }

  function reset() {
    setMessages([])
    setConversationId(undefined)
    setError('')
    setInput('')
  }

  // The page never had this: a component that owns a SpeechRecognition and an Audio must release both
  // when it goes away, or a route change leaves the microphone listening and the reply still playing.
  useEffect(() => () => {
    try { recognitionRef.current?.abort() } catch { /* already gone */ }
    const a = audioRef.current
    if (a) { try { a.pause(); a.src = '' } catch { /* already gone */ } }
  }, [])

  return {
    messages, input, setInput, loading, error, mode, setMode,
    callActive, listening, speaking, pending, transcript, bottomRef,
    // The element that is actually making the sound, so a caller can measure it. Nothing else in the
    // hook exposes the audio, and a meter that is not measuring the real thing is a decoration.
    audioRef,
    sendMessage, speakText, startListening, startCall, endCall, handleChatSubmit, reset,
  }
}
