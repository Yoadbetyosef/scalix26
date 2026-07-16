import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { listProjects, createProject } from '@/lib/commerce/projects'

const schema = z.object({ name: z.string().min(1).max(300), customerName: z.string().max(300).nullable().optional(), projectType: z.string().max(120).nullable().optional() })

export async function GET() {
  const c = await requireCommercePermission('commerce.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ projects: await listProjects() })
}

export async function POST(req: NextRequest) {
  const c = await requireCommercePermission('commerce.create')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createProject(parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, project: r.project })
}
