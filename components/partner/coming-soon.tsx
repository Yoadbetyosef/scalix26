import { Sparkles } from 'lucide-react'

export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline-strong bg-surface p-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-subtle">{blurb}</p>
    </div>
  )
}
