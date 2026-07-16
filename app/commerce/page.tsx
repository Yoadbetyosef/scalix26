import { redirect } from 'next/navigation'

// Commerce landing → Catalog for now (Projects becomes the default home in Phase 2).
export default function CommerceHome() {
  redirect('/commerce/catalog')
}
