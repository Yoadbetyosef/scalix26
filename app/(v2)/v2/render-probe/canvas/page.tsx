import { notFound } from 'next/navigation'
import { CanvasProbe } from './client'

// The canvas alone, at a size and a state you choose:  /v2/render-probe/canvas?state=listening&size=420
// Dev only, like the rest of the probe. See ../page.tsx.

export const dynamic = 'force-dynamic'

export default async function CanvasProbePage({
  searchParams,
}: { searchParams: Promise<{ state?: string; size?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { state = 'idle', size = '420' } = await searchParams
  const px = Math.max(96, Math.min(1200, Number(size) || 420))
  return (
    <div style={{ margin: 0, background: '#f6f7f9', minHeight: '100vh' }}>
      <CanvasProbe state={state} size={px} />
    </div>
  )
}
