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
        resolved: 'bg-[#4ecdc4]/10 text-[#3db8af]',
        closed: 'bg-red-100 text-red-700',
        connected: 'bg-green-100 text-green-700',
        disconnected: 'bg-gray-100 text-gray-500',
        pending: 'bg-yellow-100 text-yellow-700',
        sms: 'bg-blue-100 text-blue-700',
        voice: 'bg-purple-100 text-purple-700',
        whatsapp: 'bg-green-100 text-green-700',
        instagram: 'bg-pink-100 text-pink-700',
        facebook: 'bg-indigo-100 text-indigo-700',
        email: 'bg-indigo-50 text-indigo-600',
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
