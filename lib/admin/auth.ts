import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'yoadbetyosef@gmail.com').split(',').map(e => e.trim())

export async function isAdmin(req?: NextRequest): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user && ADMIN_EMAILS.includes(user.email || '')
}

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email)
}
