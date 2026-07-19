// Pure, server-import-free helpers for the category picker/manager (unit-tested).

export interface CategoryLite { id: string; name: string; group_label: string | null; sort_order: number; archived_at?: string | null }

// Case-insensitive substring search over category name + group label.
export function filterCategories<T extends CategoryLite>(cats: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return cats
  return cats.filter((c) => c.name.toLowerCase().includes(q) || (c.group_label ?? '').toLowerCase().includes(q))
}

// Group categories under their group_label (ungrouped last), preserving sort order within each group.
export function groupCategories<T extends CategoryLite>(cats: T[]): { group: string | null; items: T[] }[] {
  const order: (string | null)[] = []
  const map = new Map<string | null, T[]>()
  for (const c of [...cats].sort((a, b) => a.sort_order - b.sort_order)) {
    const g = c.group_label || null
    if (!map.has(g)) { map.set(g, []); order.push(g) }
    map.get(g)!.push(c)
  }
  // named groups first (in first-seen order), the ungrouped bucket last
  return order.sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0)).map((g) => ({ group: g, items: map.get(g)! }))
}

// Normalize a user-entered category name (trim + collapse whitespace).
export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}
