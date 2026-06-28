'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'

export function BookingForm({ token }: { token: string }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!phone.trim() || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/inbound/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || undefined, phone: phone.trim(), issue: message.trim() || undefined, source: 'web_form' }),
      })
      if (!res.ok) throw new Error()
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
          <Check className="w-7 h-7 text-green-600" />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Thanks!</h2>
        <p className="text-gray-500 text-sm mt-1">We&apos;ll text you right away.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input
        placeholder="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        className="h-12"
      />
      <Input
        placeholder="Phone number"
        type="tel"
        required
        value={phone}
        onChange={e => setPhone(e.target.value)}
        className="h-12"
      />
      <textarea
        placeholder="Tell us what you need help with... (optional)"
        rows={3}
        value={message}
        onChange={e => setMessage(e.target.value)}
        className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#5B6CF0]/40"
      />
      <Button type="submit" loading={submitting} className="w-full h-12 text-base">
        Get a callback
      </Button>
      {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      <p className="text-xs text-gray-400 text-center">We&apos;ll send you a text — standard rates may apply.</p>
    </form>
  )
}
