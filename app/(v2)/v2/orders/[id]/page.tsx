import { OrderBody } from './body'

// A thin route over the shared body. The same component renders in the two-pane list's right side,
// so a detail is one implementation reachable two ways rather than two that drift.
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <OrderBody id={(await params).id} />
}
