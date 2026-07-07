// Transcribe a remote audio file (e.g. an Instagram/Facebook voice message) with Deepgram's
// pre-recorded API. Deepgram fetches the URL itself. Language is auto-detected so non-English
// voice notes work too. Returns '' on any failure — the caller decides what to do.
export async function transcribeAudioUrl(audioUrl: string): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key || !audioUrl) return ''
  try {
    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true&punctuate=true', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: audioUrl }),
    })
    if (!res.ok) return ''
    const j = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } }
    return (j?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim()
  } catch {
    return ''
  }
}
