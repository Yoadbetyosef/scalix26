import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        active: 'bg-green-100 text-green-700',
        draft: 'bg-gray-100 text-gray-600',
        open: 'bg-blue-100 text-blue-700',
        resolved: 'bg-accent/10 text-accent-strong',
        closed: 'bg-red-100 text-red-700',
        connected: 'bg-green-100 text-green-700',
        disconnected: 'bg-gray-100 text-gray-500',
        pending: 'bg-yellow-100 text-yellow-700',
        sms: 'bg-amber-100 text-amber-700',
        voice: 'bg-green-100 text-green-700',
        whatsapp: 'bg-emerald-100 text-emerald-700',
        instagram: 'bg-pink-100 text-pink-700',
        facebook: 'bg-purple-100 text-purple-700',
        email: 'bg-blue-100 text-blue-700',
        positive: 'bg-green-100 text-green-700',
        neutral: 'bg-gray-100 text-gray-600',
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
