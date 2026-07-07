// Central permission map for the personal assistant. The assistant does NOT get unlimited
// access — every action is gated by a permission here. Admin per-business/per-user overrides
// are a later phase; for now this is the single source of defaults.

export type Permission =
  | 'can_send_email'
  | 'can_reply_social'
  | 'can_send_sms'
  | 'can_send_whatsapp'
  | 'can_send_payment_links'
  | 'can_edit_catalog'
  | 'can_update_leads'
  | 'can_book_appointments'
  | 'can_create_estimates'
  | 'can_send_invoices'
  | 'can_create_tasks'

export const DEFAULT_PERMISSIONS: Record<Permission, boolean> = {
  can_send_email: true,
  can_reply_social: true,
  can_send_sms: true,
  can_send_whatsapp: true,
  can_send_payment_links: true,
  can_edit_catalog: true,
  can_update_leads: true,
  can_book_appointments: true,
  can_create_estimates: true,
  can_send_invoices: true,
  can_create_tasks: true,
}

// Placeholder for per-tenant/user overrides (wired to an admin UI later). For now returns the
// default map so the gate exists and is enforced everywhere.
export function permissionsFor(_tenantId?: string, _userId?: string): Record<Permission, boolean> {
  return DEFAULT_PERMISSIONS
}

export function hasPermission(perm: Permission, tenantId?: string, userId?: string): boolean {
  return !!permissionsFor(tenantId, userId)[perm]
}
