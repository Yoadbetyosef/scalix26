import { cn } from '@/lib/utils'

// Loading placeholder. Uses the sunken surface token + the app's pulse so it matches existing shimmer.
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-sunken', className)} aria-hidden="true" />
}
