'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { EmptyRow, Panel } from '@/components/partner/ui'
import { CheckCircle2, Circle, Award, GraduationCap } from 'lucide-react'

interface Course { id: string; title: string; description: string | null; cert_on_complete: boolean }
interface Lesson { id: string; course_id: string; title: string; body: string | null; sort: number; quiz: { q: string; options: string[]; answer_index: number }[] | null }
interface Enrollment { course_id: string; progress: Record<string, string>; completed_at: string | null }
interface Cert { course_id: string; badge: string; score: number }

export function Academy() {
  const [data, setData] = useState<{ courses: Course[]; lessons: Lesson[]; enrollments: Enrollment[]; certs: Cert[] } | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [examAnswers, setExamAnswers] = useState<Record<number, number>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/learning'); const j = await res.json()
    setData(j); if (!active && j.courses?.[0]) setActive(j.courses[0].id)
  }, [active])
  useEffect(() => { load() }, [load])

  if (!data) return <EmptyRow>Loading…</EmptyRow>
  if (!data.courses.length) return <EmptyRow>No courses yet.</EmptyRow>

  const course = data.courses.find((c) => c.id === active) || data.courses[0]
  const lessons = data.lessons.filter((l) => l.course_id === course.id)
  const enrollment = data.enrollments.find((e) => e.course_id === course.id)
  const progress = enrollment?.progress || {}
  const cert = data.certs.find((c) => c.course_id === course.id)
  const examLesson = lessons.filter((l) => l.quiz?.length).slice(-1)[0]
  const contentLessons = lessons.filter((l) => l.id !== examLesson?.id)
  const allContentDone = contentLessons.every((l) => progress[l.id])

  async function completeLesson(id: string) {
    await fetch('/api/partner/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: course.id, lessonId: id }) })
    load()
  }
  async function submitExam() {
    if (!examLesson) return
    const answers = examLesson.quiz!.map((_, i) => examAnswers[i] ?? -1)
    const res = await fetch('/api/partner/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: course.id, examAnswers: answers }) })
    const j = await res.json()
    if (j.passed) toast.success(`Passed with ${j.score}%! Badge earned 🎓`)
    else toast.error(`Scored ${j.score}%. You need 70% — review and retry.`)
    load()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div className="space-y-1">
        {data.courses.map((c) => {
          const done = data.certs.some((x) => x.course_id === c.id)
          return (
            <button key={c.id} onClick={() => setActive(c.id)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${c.id === course.id ? 'bg-sunken font-medium text-ink' : 'text-subtle hover:bg-sunken/60'}`}>
              {done ? <Award className="h-4 w-4 text-accent-strong" /> : <GraduationCap className="h-4 w-4" />}
              <span className="flex-1">{c.title}</span>
            </button>
          )
        })}
      </div>

      <div className="space-y-4">
        {cert && (
          <div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4">
            <Award className="h-8 w-8 text-accent-strong" />
            <div><div className="font-semibold text-ink">{cert.badge}</div><div className="text-sm text-subtle">Earned with {cert.score}%. You&apos;re certified to sell Scalix26.</div></div>
          </div>
        )}
        <Panel title={course.title}>
          <div className="space-y-2">
            {contentLessons.map((l) => (
              <div key={l.id} className="rounded-xl border border-hairline p-3">
                <button onClick={() => completeLesson(l.id)} className="flex w-full items-start gap-2.5 text-left">
                  {progress[l.id] ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" /> : <Circle className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted" />}
                  <div>
                    <div className="text-sm font-medium text-ink">{l.title}</div>
                    {l.body && <div className="mt-0.5 text-sm text-subtle">{l.body}</div>}
                  </div>
                </button>
              </div>
            ))}
          </div>
        </Panel>

        {examLesson && !cert && (
          <Panel title="Certification exam">
            {!allContentDone ? (
              <div className="text-sm text-muted">Complete all lessons above to unlock the exam.</div>
            ) : (
              <div className="space-y-4">
                {examLesson.quiz!.map((qq, i) => (
                  <div key={i}>
                    <div className="mb-1.5 text-sm font-medium text-ink">{i + 1}. {qq.q}</div>
                    <div className="space-y-1">
                      {qq.options.map((opt, oi) => (
                        <label key={oi} className="flex items-center gap-2 text-sm text-subtle">
                          <input type="radio" name={`q${i}`} checked={examAnswers[i] === oi} onChange={() => setExamAnswers((a) => ({ ...a, [i]: oi }))} />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <button onClick={submitExam} className="h-10 rounded-lg bg-ink px-5 text-sm font-medium text-white">Submit exam</button>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
