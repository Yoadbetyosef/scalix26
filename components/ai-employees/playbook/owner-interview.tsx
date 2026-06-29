'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

// High-leverage owner-interview questions — vertical-agnostic. The question text is the
// stable key stored in ai_employees.onboarding_answers, so it flows straight into playbook
// generation. Conversational, one at a time, never a long form.
export const INTERVIEW_QUESTIONS: { q: string; hint: string }[] = [
  { q: 'What should your AI always say or offer?', hint: 'e.g. mention free estimates, always confirm the address' },
  { q: 'What should your AI never say or promise?', hint: 'e.g. never give an exact price, never promise same-day' },
  { q: 'How do you usually answer pricing questions?', hint: 'e.g. give a range, then offer to book a quote' },
  { q: 'When should the AI book an appointment?', hint: 'e.g. once they share the job, address, and a time' },
  { q: 'When should it transfer or escalate to you?', hint: 'e.g. legal questions, big commercial jobs, complaints' },
  { q: 'What types of customers are high value?', hint: 'e.g. commercial accounts, repeat clients, urgent jobs' },
  { q: 'What jobs or customers do you NOT want?', hint: 'e.g. out-of-area, tire-kickers, work you don’t offer' },
  { q: 'What questions do customers ask most?', hint: 'list the top few and your usual answers' },
  { q: 'What makes someone ready to book?', hint: 'the signals that mean "go for it"' },
  { q: 'What should the AI do if it’s unsure?', hint: 'your safety net — e.g. take a message, say the team follows up' },
  { q: 'How aggressive should it be about booking?', hint: 'e.g. gently suggest vs always push for the appointment' },
  { q: 'How should it sound?', hint: 'professional, warm, luxury, direct, casual, funny, or urgent' },
]

export function OwnerInterview({
  agentId,
  initial,
  onDone,
}: {
  agentId: string
  initial: Record<string, string>
  onDone: (answers: Record<string, string>) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initial || {})
  const [i, setI] = useState(0)
  const [saving, setSaving] = useState(false)
  const current = INTERVIEW_QUESTIONS[i]
  const isLast = i === INTERVIEW_QUESTIONS.length - 1
  const answered = Object.values(answers).filter((v) => v && v.trim()).length

  async function save(final: boolean) {
    setSaving(true)
    try {
      await fetch(`/api/playbook/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_answers: answers }),
      })
      if (final) onDone(answers)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between text-xs text-muted">
        <span>Question {i + 1} of {INTERVIEW_QUESTIONS.length}</span>
        <span>{answered} answered</span>
      </div>
      <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${((i + 1) / INTERVIEW_QUESTIONS.length) * 100}%` }} />
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-e2 ring-1 ring-hairline">
        <h3 className="text-lg font-light leading-snug text-ink">{current.q}</h3>
        <p className="mt-1 text-xs text-muted">{current.hint}</p>
        <Textarea
          autoFocus
          value={answers[current.q] || ''}
          onChange={(e) => setAnswers((a) => ({ ...a, [current.q]: e.target.value }))}
          placeholder="Type how you'd handle it…"
          className="mt-4 min-h-[110px]"
        />

        <div className="mt-5 flex items-center justify-between">
          <Button variant="ghost" size="sm" disabled={i === 0 || saving} onClick={() => setI((n) => Math.max(0, n - 1))}>
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => (isLast ? save(true) : setI((n) => n + 1))}>
              Skip
            </Button>
            {isLast ? (
              <Button size="sm" loading={saving} onClick={() => save(true)}>
                Build playbook
              </Button>
            ) : (
              <Button size="sm" disabled={saving} onClick={() => setI((n) => n + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 text-center">
        <button onClick={() => save(true)} disabled={saving} className="text-xs font-medium text-muted transition-colors hover:text-ink">
          Skip the rest & build from what I’ve answered
        </button>
      </div>
    </div>
  )
}
