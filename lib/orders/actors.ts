import { createAdminClient } from '@/lib/supabase/server'

// WHO DID IT, in words.
//
// order_events.actor holds the signed-in user's id for anything a person did, and a plain word —
// 'factory', 'customer', 'system' — for anything that happened at the other end of a link. The
// timeline printed the uuid. A history that says "a6248560-f2cb-… moved this to Production" is one
// nobody reads, and the whole reason the timeline exists is to be read instead of the inbox.
//
// Resolved through Supabase auth, which is where the user record lives; there is no members table
// to join. One lookup per distinct id per page, which on an order is one or two.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WORDS: Record<string, string> = { factory: 'Factory', customer: 'Customer', system: 'System' }

export async function actorLabels(actors: Array<string | null | undefined>): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const ids = [...new Set(actors.filter((a): a is string => !!a))]
  const admin = createAdminClient()
  await Promise.all(ids.map(async (id) => {
    if (WORDS[id]) { out[id] = WORDS[id]; return }
    if (!UUID.test(id)) { out[id] = id; return }
    try {
      const { data } = await admin.auth.admin.getUserById(id)
      const u = data?.user
      const name = (u?.user_metadata?.full_name as string) || (u?.user_metadata?.name as string) || u?.email || null
      out[id] = name ?? 'Staff'
    } catch {
      out[id] = 'Staff'
    }
  }))
  return out
}

/** The label for one actor, from a resolved map. A missing id reads as staff rather than as nothing. */
export const actorLabel = (labels: Record<string, string>, actor: string | null | undefined): string =>
  actor ? (labels[actor] ?? 'Staff') : 'System'
