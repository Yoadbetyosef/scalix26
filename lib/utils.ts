import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date, timeZone?: string) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  })
}

export function formatTime(date: string | Date, timeZone?: string) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    // Show the tz abbreviation (e.g. "EDT") only when an explicit zone is passed, so
    // the time is unambiguous; with no zone it keeps the original (runtime-local) format.
    ...(timeZone ? { timeZone, timeZoneName: 'short' } : {}),
  })
}

export function formatDateTime(date: string | Date, timeZone?: string) {
  return `${formatDate(date, timeZone)} ${formatTime(date, timeZone)}`
}

// Does a string look like a real person's name (not a raw STT utterance)?
// ~1–3 short alphabetic words; no digits, no question marks. Guards against garbled
// voice transcripts (e.g. "Did I call John Oreo add?") becoming a title/contact name.
export function looksLikeName(value: string | null | undefined): boolean {
  if (!value) return false
  const s = value.trim()
  if (s.length < 2 || s.length > 40) return false
  if (/[\d?]/.test(s)) return false
  const words = s.split(/\s+/)
  if (words.length > 3) return false
  return words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w))
}

export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatPhone(phone: string) {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  return phone
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function truncate(str: string, length: number) {
  if (str.length <= length) return str
  return `${str.slice(0, length)}...`
}

// Strip markdown so plain-text channels (SMS, WhatsApp, TTS) never show literal
// formatting like **bold**, _italics_, `code`, # headers, or - bullets.
//
// This matters most for speech: a text-to-speech engine reads "**Albero**" out as "star star Albero
// star star". Anything on its way to being spoken must come through here, and unpaired symbols get
// swept too — a model that opens a bold and never closes it would otherwise still be read aloud.
export function stripMarkdown(text: string): string {
  if (!text) return text
  return text
    .replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1')   // ```fenced blocks```
    .replace(/`([^`]*)`/g, '$1')                    // `code`
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')       // ![image](url) → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')        // [label](url) → label, never read the URL aloud
    .replace(/(\*\*\*|___)(.*?)\1/g, '$2')          // ***bold italic***
    .replace(/(\*\*|__)(.*?)\1/g, '$2')             // **bold** / __bold__
    .replace(/(\*|_)(?=\S)(.*?\S)\1/g, '$2')        // *italic* / _italic_
    .replace(/~~(.*?)~~/g, '$1')                    // ~~strikethrough~~
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')             // # headers
    .replace(/^\s{0,3}>\s?/gm, '')                  // > blockquotes
    .replace(/^\s*[-*+]\s+/gm, '')                  // - * + bullets
    .replace(/^\s*\d+\.\s+/gm, '')                  // 1. 2. numbered lists
    .replace(/^\s*([-*_])\s*(?:\1\s*){2,}$/gm, '')  // --- *** ___ horizontal rules
    // Whatever emphasis markers survived the paired rules above were unbalanced. They are never
    // meaningful in a spoken sentence, so they go rather than being read out.
    .replace(/\*+/g, '')
    .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1')          // stray _ at a word edge; keeps snake_case intact
    .replace(/[ \t]{2,}/g, ' ')                     // collapse extra spaces
    .replace(/\n{3,}/g, '\n\n')                     // collapse blank lines
    .trim()
}

// The instruction every voice prompt carries. Stripping guarantees the text channels, but a live voice
// agent (Deepgram) runs the model and the TTS inside itself — its words never pass through our code
// before they are spoken, so for those the prompt is the only lever there is.
export const NO_MARKDOWN_RULE =
  'FORMATTING: You are being spoken aloud. Write plain spoken sentences only — never use asterisks, underscores, backticks, hashes, bullet points, numbered lists, or any markdown. Never write **bold**: it is read out loud as "star star". Say names and numbers plainly, as a person would on the phone.'

// Social channels (Facebook/Instagram) store the platform user id in the
// contact's `phone` field — it is NOT a real phone number.
export function isSocialChannel(channel?: string | null): boolean {
  return channel === 'facebook' || channel === 'instagram'
}

// Describes how to display a contact's primary identifier (phone vs social id).
export function contactIdentifier(channel?: string | null, phone?: string | null) {
  if (!phone) return null
  if (isSocialChannel(channel)) {
    return {
      value: phone,
      label: channel === 'facebook' ? 'Facebook user' : 'Instagram user',
      isPhone: false,
    }
  }
  return { value: phone, label: 'Phone', isPhone: true }
}
