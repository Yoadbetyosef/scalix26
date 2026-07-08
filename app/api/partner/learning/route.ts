import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { awardXp, XP } from '@/lib/partner/xp'

// Courses + lessons + the caller's enrollment/progress + earned certs.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const [{ data: courses }, { data: lessons }, { data: enrollments }, { data: certs }] = await Promise.all([
    db.from('courses').select('*').eq('active', true).order('sort'),
    db.from('lessons').select('id, course_id, title, body, video_url, sort, quiz').order('sort'),
    db.from('enrollments').select('*').eq('user_id', ctx.userId),
    db.from('certifications').select('course_id, badge, score, issued_at').eq('user_id', ctx.userId),
  ])
  return NextResponse.json({ courses: courses || [], lessons: lessons || [], enrollments: enrollments || [], certs: certs || [] })
}

// Mark a lesson complete, or submit the exam. body: { courseId, lessonId } OR { courseId, examAnswers: number[] }
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b.courseId) return NextResponse.json({ error: 'courseId required' }, { status: 400 })
  const db = createAdminClient()

  // Ensure enrollment.
  const { data: enr } = await db.from('enrollments').upsert(
    { partner_id: ctx.partnerId, user_id: ctx.userId, course_id: b.courseId },
    { onConflict: 'user_id,course_id', ignoreDuplicates: true }
  ).select('*').maybeSingle()
  let enrollment = enr
  if (!enrollment) enrollment = (await db.from('enrollments').select('*').eq('user_id', ctx.userId).eq('course_id', b.courseId).maybeSingle()).data

  // Mark a lesson complete.
  if (b.lessonId) {
    const alreadyDone = !!(enrollment?.progress || {})[b.lessonId]
    const progress = { ...(enrollment?.progress || {}), [b.lessonId]: new Date().toISOString() }
    await db.from('enrollments').update({ progress }).eq('user_id', ctx.userId).eq('course_id', b.courseId)
    if (!alreadyDone) await awardXp(ctx.partnerId, 'lesson_complete', XP.lesson_complete, { uniqueKey: `lesson:${ctx.userId}:${b.lessonId}`, userId: ctx.userId })
    return NextResponse.json({ ok: true, progress })
  }

  // Submit the exam: grade against the exam lesson's quiz.
  if (Array.isArray(b.examAnswers)) {
    const { data: examLesson } = await db.from('lessons').select('quiz').eq('course_id', b.courseId).not('quiz', 'is', null).order('sort', { ascending: false }).limit(1).maybeSingle()
    const quiz = (examLesson?.quiz || []) as { answer_index: number }[]
    if (!quiz.length) return NextResponse.json({ error: 'No exam for this course.' }, { status: 400 })
    let correct = 0
    quiz.forEach((qq, i) => { if (b.examAnswers[i] === qq.answer_index) correct++ })
    const score = Math.round((correct / quiz.length) * 100)
    const passed = score >= 70
    if (passed) {
      await db.from('certifications').insert({ partner_id: ctx.partnerId, user_id: ctx.userId, course_id: b.courseId, score, badge: 'Certified Partner' })
      await db.from('enrollments').update({ completed_at: new Date().toISOString() }).eq('user_id', ctx.userId).eq('course_id', b.courseId)
      await db.from('partner_notifications').insert({ partner_id: ctx.partnerId, user_id: ctx.userId, kind: 'cert_earned', title: 'Certification earned! 🎓', body: `You scored ${score}% and earned the Certified Partner badge.`, link: '/partner/learning' })
      await awardXp(ctx.partnerId, 'certification', XP.certification, { uniqueKey: `cert:${ctx.userId}:${b.courseId}`, userId: ctx.userId })
    }
    return NextResponse.json({ ok: true, score, passed })
  }

  return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
}
