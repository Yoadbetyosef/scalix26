'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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

  return (
    <div className="px-3 sm:px-4 py-3 border-t border-gray-100 bg-white flex-shrink-0">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Type a message to the customer…"
          disabled={sending}
          className="flex-1 h-11"
        />
        <Button type="submit" disabled={sending || !value.trim()} loading={sending} className="h-11 w-11 p-0 flex-shrink-0">
          {!sending && <Send className="w-4 h-4" />}
        </Button>
      </form>
    </div>
  )
}
