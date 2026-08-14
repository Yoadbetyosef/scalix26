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
    setSpeaking(true)
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
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); if (callActive) startListening() }
      audio.onerror = () => { setSpeaking(false); if (callActive) startListening() }
      await audio.play()
    } catch {
      setSpeaking(false)
      if (callActive) startListening()
    }
  }

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setError('Speech recognition not supported in this browser'); return }

    const recognition = new SR()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false
    recognitionRef.current = recognition

    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)

    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1]
      const text = result[0].transcript
      setTranscript(text)
      if (result.isFinal && text.trim()) {
        setTranscript('')
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
    speakText(greeting).then(() => {
      if (!speaking) startListening()
    })
  }

  function endCall() {
    setCallActive(false)
    setListening(false)
    setSpeaking(false)
    setTranscript('')
    recognitionRef.current?.stop()
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
    callActive, listening, speaking, transcript, bottomRef,
    sendMessage, speakText, startListening, startCall, endCall, handleChatSubmit, reset,
  }
}
