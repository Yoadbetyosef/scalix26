'use client'

import { useEffect, useState } from 'react'
import { Activity as ActivityIcon, FileText } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

interface ActivityRow { id: string; type: string; title: string | null; body: string | null; occurred_at: string }
interface FileRow { id: string; name?: string | null; file_name?: string | null; content_type?: string | null; created_at: string }

const when = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }

export function ProductActivity({ productId }: { productId: string }) {
  const [data, setData] = useState<{ activities: ActivityRow[]; files: FileRow[] } | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/core/products/${productId}/activity`).then((r) => r.json()).then((d) => { if (live) setData({ activities: d.activities ?? [], files: d.files ?? [] }) }).catch(() => { if (live) setData({ activities: [], files: [] }) })
    return () => { live = false }
  }, [productId])

  if (!data) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  if (!data.activities.length && !data.files.length) return <EmptyState icon={ActivityIcon} title="No activity yet">Changes, notes and files for this product will appear here over time.</EmptyState>

  return (
    <div className="max-w-2xl space-y-6">
      {data.files.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Files</h3>
          <ul className="space-y-2">
            {data.files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-card border border-hairline bg-surface p-3 text-sm shadow-e1">
                <FileText className="h-4 w-4 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1 truncate text-ink">{f.name || f.file_name || 'File'}</span>
                <span className="shrink-0 text-xs text-muted">{when(f.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.activities.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Timeline</h3>
          <ul className="space-y-4">
            {data.activities.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm text-ink">{a.title || a.type}</p>
                  {a.body && <p className="mt-0.5 text-sm text-subtle">{a.body}</p>}
                  <p className="mt-0.5 text-xs text-muted">{when(a.occurred_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
