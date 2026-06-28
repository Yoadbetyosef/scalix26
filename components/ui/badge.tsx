import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        active: 'bg-green-100 text-green-700',
        draft: 'bg-sunken text-subtle',
        open: 'bg-blue-100 text-blue-700',
        resolved: 'bg-accent/10 text-accent-strong',
        closed: 'bg-red-100 text-red-700',
        connected: 'bg-green-100 text-green-700',
        disconnected: 'bg-sunken text-subtle',
        pending: 'bg-yellow-100 text-yellow-700',
        sms: 'bg-emerald-100 text-emerald-700',
        voice: 'bg-cyan-100 text-cyan-700',
        whatsapp: 'bg-green-100 text-green-700',
        instagram: 'bg-pink-100 text-pink-700',
        facebook: 'bg-blue-100 text-blue-700',
        email: 'bg-violet-100 text-violet-700',
        positive: 'bg-green-100 text-green-700',
        neutral: 'bg-sunken text-subtle',
        negative: 'bg-red-100 text-red-700',
      },
    },
    defaultVariants: { variant: 'draft' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
