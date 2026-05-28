import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { businessName, industry, userId, email } = await req.json()

  const supabase = await createServiceClient()

  // Check if tenant already exists
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (existing) {
    // Update existing tenant instead of creating duplicate
    const { error } = await supabase
      .from('tenants')
      .update({ business_name: businessName, industry })
      .eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    const { error } = await supabase.from('tenants').insert({
      user_id: userId,
      business_name: businessName,
      industry,
      email,
      plan: 'trial',
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
