'use client'

import { useState } from 'react'

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
    <div style={{ maxWidth: 620 }}>
      {/* THE PROGRESS RULE, not a bar in a track. Same 2px gradient as the tab underline and the
          website sync — one way of saying "this far along" for the whole product. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <p className="v2-kick" style={{ marginBottom: 0 }}>Question {i + 1} of {INTERVIEW_QUESTIONS.length}</p>
        <s style={{ flex: 1 }} />
        <p className="v2-kick" style={{ marginBottom: 0 }}>{answered} answered</p>
      </div>
      <div style={{ height: 2, borderRadius: 2, background: 'var(--v2-line)', overflow: 'hidden', marginBottom: 26 }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: 'linear-gradient(90deg, var(--v2-t1), var(--v2-t3) 60%, var(--v2-t4))',
          width: `${((i + 1) / INTERVIEW_QUESTIONS.length) * 100}%`, transition: 'width 0.3s',
        }} />
      </div>

      {/* One question at a time, and it is the only thing on the screen — so it is set as a question,
          not as the title of a card. v1 wrapped it in a 24px-radius surface with a second shadow. */}
      <h3 style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.3, letterSpacing: '-0.015em', color: 'var(--v2-ink)' }}>{current.q}</h3>
      <p className="v2-hint" style={{ marginTop: 6, marginBottom: 18 }}>{current.hint}</p>

      <div className="v2-fld">
        <label htmlFor="oi-answer">Your answer</label>
        <textarea
          id="oi-answer"
          autoFocus
          rows={4}
          value={answers[current.q] || ''}
          onChange={(e) => setAnswers((a) => ({ ...a, [current.q]: e.target.value }))}
          placeholder="Type how you’d handle it…"
        />
      </div>

      <div className="v2-bar" style={{ marginTop: 22 }}>
        <button disabled={i === 0 || saving} onClick={() => setI((n) => Math.max(0, n - 1))} className="v2-act tap-target">Back</button>
        <s style={{ flex: 1 }} />
        <button disabled={saving} onClick={() => (isLast ? save(true) : setI((n) => n + 1))} className="v2-act tap-target">Skip</button>
        {isLast ? (
          <button disabled={saving} onClick={() => save(true)} className="v2-act tap-target" data-solid>{saving ? 'Building…' : 'Build playbook'}</button>
        ) : (
          <button disabled={saving} onClick={() => setI((n) => n + 1)} className="v2-act tap-target" data-solid>Next</button>
        )}
      </div>

      <p style={{ marginTop: 20 }}>
        <button onClick={() => save(true)} disabled={saving} className="v2-act tap-target">
          Skip the rest &amp; build from what I’ve answered
        </button>
      </p>
    </div>
  )
}
