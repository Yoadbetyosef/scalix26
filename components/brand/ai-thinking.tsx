import { cn } from '@/lib/utils'

/**
 * The brand "thinking" signal — five waveform bars breathing in the accent blue.
 * Replaces generic spinners so every wait reinforces "my AI is working." Pure CSS
 * (transform only), stills under prefers-reduced-motion. Server-component safe.
 */
export function AiThinking({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3', className)} role="status" aria-live="polite">
      <div className="flex items-end gap-[3px] h-5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="sx-wavebar w-[3px] h-full rounded-full bg-accent"
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>
      {label && <p className="text-xs font-medium text-subtle">{label}</p>}
    </div>
  )
}
