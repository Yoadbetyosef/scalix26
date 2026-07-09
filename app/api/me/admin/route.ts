import { NextResponse } from 'next/server'
import { getAdminContext } from '@/lib/admin/rbac'

// Lightweight self-check so the app shell can show an Admin link to admins only. Returns the
// caller's own admin status (no data leak) — reuses the existing admin_users/allow-list resolver.
export async function GET() {
  const ctx = await getAdminContext()
  return NextResponse.json({ isAdmin: !!ctx, role: ctx?.role ?? null })
}
