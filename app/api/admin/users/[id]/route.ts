import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { sendEmail } from '@/lib/email/send'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const supabase = await createServiceClient()

  const { data: tenant } = await supabase.from('tenants').select('*').eq('id', id).single()
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: employees }, { data: channels }, { data: conversations }] = await Promise.all([
    supabase.from('ai_employees').select('id, name, status').eq('tenant_id', id),
    supabase.from('channels').select('type, status, meta_page_id, twilio_number').eq('tenant_id', id),
    supabase.from('conversations').select('id, status, created_at').eq('tenant_id', id).order('created_at', { ascending: false }).limit(50),
  ])

  const { data: { user: authUser } } = await supabase.auth.admin.getUserById(tenant.user_id)

  return NextResponse.json({ tenant, authUser, employees, channels, conversations })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = await req.json()
  const supabase = await createServiceClient()

  const allowed = ['plan', 'business_name', 'phone', 'email']
  const update = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))

  const { error } = await supabase.from('tenants').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const { action } = await req.json()
  const supabase = await createServiceClient()

  const { data: tenant } = await supabase.from('tenants').select('*').eq('id', id).single()
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'reset_password') {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: tenant.email,
      options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/update-password` },
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const resetLink = data.properties?.action_link
    const result = await sendEmail(tenant.email, 'Reset your Scalix password',
      `<p>Hi ${tenant.business_name},</p><p>An admin has sent you a password reset link. Click the button below to reset your password:</p><p><a href="${resetLink}" style="background:#4ecdc4;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">Reset Password</a></p><p>If you didn't request this, you can ignore this email.</p>`)
    if (result?.error) return NextResponse.json({ error: `Email failed: ${result.error}` }, { status: 500 })
    return NextResponse.json({ success: true, message: 'Reset email sent' })
  }

  if (action === 'impersonate') {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: tenant.email,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ url: data.properties.action_link })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
