'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Props {
  conversationId: string
}

export function MessageComposer({ conversationId }: Props) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      setValue('')
      if (data.note) toast.info(data.note)
      else toast.success('Message sent')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  // RULE, NOT BOX — the kit's form language. The composer was the one field in the app that argued
  // for a box, on the grounds that it is a thing you type *into* rather than a value you edit. It
  // isn't: the transcript above it is already a stack of bounded shapes, and a bordered box under
  // them adds a fourth edge to a screen that has three. The label is the field's own micro-label,
  // which also says who the message reaches — the thing v1 hid inside a placeholder.
  return (
    <div className="px-4 sm:px-6 py-3 border-t border-hairline flex-shrink-0">
      <form onSubmit={submit} className="flex items-end gap-3">
        <div className="v2-fld flex-1">
          <label htmlFor="composer">Reply to the customer</label>
          <input
            id="composer"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Type a message…"
            disabled={sending}
            autoComplete="off"
          />
        </div>
        <button type="submit" className="v2-act" disabled={sending || !value.trim()}
                style={{ ['--ghue' as string]: 'var(--v2-t1)', paddingBottom: 9, paddingTop: 9 }}>
          <Send className="w-3.5 h-3.5" />
          {sending ? 'Sending' : 'Send'}
        </button>
      </form>
    </div>
  )
}
