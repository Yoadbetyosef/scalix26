import { redirect } from 'next/navigation'
import { resolveRootDestination } from '@/lib/routing'

// The single post-auth entry point. Delegates to the ONE shared resolver (lib/routing.ts) so business
// ownership always wins over partner/admin status — a partner record never hijacks the root route.
// Partner access is explicit via /partner; admin via /admin.
export default async function HomePage() {
  redirect(await resolveRootDestination())
}
