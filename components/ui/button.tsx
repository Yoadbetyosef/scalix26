import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Premium base — SCALIX language. Smooth motion, soft focus ring (ink, not teal),
  // gentle press. Color comes from the variant; the brand waveform stays the accent.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        // Primary — near-black ink, slight elevation that lifts on hover (Apple/Linear).
        default: 'bg-ink text-white shadow-e1 hover:bg-ink/90 hover:shadow-e2 hover:-translate-y-px',
        // Destructive — minimal, elegant, never aggressive. Quiet red that warms on hover.
        destructive: 'bg-white text-danger border border-danger/20 hover:border-danger/40 hover:bg-danger/[0.04]',
        // Secondary — white, soft border, clean hover, subtle float.
        outline: 'border border-hairline-strong bg-white text-ink shadow-e1 hover:bg-sunken hover:shadow-e2 hover:-translate-y-px',
        ghost: 'text-subtle hover:bg-sunken hover:text-ink',
        link: 'text-ink underline-offset-4 hover:underline',
        sidebar: 'text-subtle hover:bg-sunken hover:text-ink w-full justify-start',
        'sidebar-active': 'bg-sunken text-ink w-full justify-start',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-11 px-3 text-xs min-w-[44px]',
        lg: 'h-12 px-6 text-base',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
