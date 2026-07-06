'use client'

import { useCallback, useState } from 'react'

/** Minimal admin toast — no dependencies. Returns a `show()` and the `node` to render. */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const show = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setMsg({ text, kind })
    window.setTimeout(() => setMsg(null), 2600)
  }, [])
  const node = msg ? (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg ${
        msg.kind === 'ok' ? 'bg-ink' : 'bg-red-600'
      }`}
    >
      {msg.text}
    </div>
  ) : null
  return { show, node }
}
