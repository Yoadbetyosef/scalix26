import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const supabase = await createServiceClient()

  const { data: tenant } = await supabase.from('tenants').select('*').eq('id', id).single()
  const { data: conversations } = await supabase
    .from('conversations').select('id, status, created_at, contact_id').eq('tenant_id', id)
  const { data: messages } = await supabase
    .from('messages').select('conversation_id, role, content, created_at')
    .in('conversation_id', (conversations || []).map(c => c.id))

  const rows = [
    ['Tenant Info'],
    ['Business', tenant?.business_name], ['Email', tenant?.email], ['Plan', tenant?.plan],
    [''],
    ['Conversation ID', 'Status', 'Created At', 'Role', 'Message', 'Timestamp'],
    ...(messages || []).map(m => {
      const conv = conversations?.find(c => c.id === m.conversation_id)
      return [conv?.id, conv?.status, conv?.created_at, m.role, m.content?.replace(/,/g, ' '), m.created_at]
    }),
  ]

  const csv = rows.map(r => r.join(',')).join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="user-${id}.csv"`,
    },
  })
}
