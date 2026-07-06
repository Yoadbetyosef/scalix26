import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/admin/rbac'

// GET /api/admin/audit — the global audit trail, paginated + searchable.
export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const page = Math.max(0, parseInt(sp.get('page') || '0', 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') || '50', 10)))
  const search = (sp.get('search') || '').trim()

  const db = await createServiceClient()
  let query = db
    .from('admin_audit_log')
    .select('id, admin_email, action, target_type, target_id, target_label, before, after, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (search) {
    const s = search.replace(/[%,]/g, '')
    query = query.or(`admin_email.ilike.%${s}%,action.ilike.%${s}%,target_label.ilike.%${s}%`)
  }

  const { data, count, error } = await query.range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entries: data || [], total: count ?? 0, page, pageSize })
}
