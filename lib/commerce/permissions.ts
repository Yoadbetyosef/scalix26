// Commerce permission model. V1: tenants are single-owner, so the tenant owner holds ALL permissions.
// The permission strings + roles below are the SCAFFOLD so a multi-user role system can be layered on
// later WITHOUT touching call sites — every gated action already asks hasCommercePermission().

export const COMMERCE_PERMISSIONS = [
  'commerce.view', 'commerce.create', 'commerce.edit', 'commerce.convert', 'commerce.reserve_inventory',
  'catalog.view', 'catalog.manage',
  'inventory.view', 'inventory.adjust',
  'purchase_orders.view', 'purchase_orders.create', 'purchase_orders.approve', 'purchase_orders.send', 'purchase_orders.receive',
  'quickbooks.invoice_create',
  'module.settings_manage',
] as const
export type CommercePermission = (typeof COMMERCE_PERMISSIONS)[number]

// Future roles (not yet assigned to users — reserved). Designer < Manager < Admin.
export const COMMERCE_ROLES = {
  admin: [...COMMERCE_PERMISSIONS],
  manager: [
    'commerce.view', 'commerce.create', 'commerce.edit', 'commerce.convert', 'commerce.reserve_inventory',
    'catalog.view', 'inventory.view', 'purchase_orders.view', 'purchase_orders.create', 'purchase_orders.approve',
    'purchase_orders.receive', 'quickbooks.invoice_create',
  ],
  designer: [
    'commerce.view', 'commerce.create', 'commerce.edit', 'commerce.reserve_inventory',
    'catalog.view', 'inventory.view', 'purchase_orders.view', 'purchase_orders.create',
  ],
} satisfies Record<string, CommercePermission[]>
export type CommerceRole = keyof typeof COMMERCE_ROLES

// V1: `role` is null for the tenant owner → every permission granted. When multi-user roles arrive,
// resolve the caller's role and pass it here; the check needs no other changes.
export function hasCommercePermission(perm: CommercePermission, role?: CommerceRole | null): boolean {
  if (!role) return true // owner
  return (COMMERCE_ROLES[role] as readonly CommercePermission[]).includes(perm)
}
