import type { CSSProperties, ReactNode } from 'react'
import { AiOrb } from './ai-orb'

export interface AuthShellProps {
  brandLogo: ReactNode
  headline: string
  subheadline: string
  children: ReactNode
}

/**
 * The doorway into the Scalix OS. A calm two-column entrance that inherits the
 * SCALIX26 website DNA: near-white canvas with a soft purple/pink ambient wash, thin
 * elegant typography, the signature AI object on the emotional left, and the form
 * placed directly on the page (no card) on the right.
 */
export function AuthShell({ brandLogo, headline, subheadline, children }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      {/* Ambient atmosphere — extremely soft, bleeding from the corners */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-48 -top-48 h-[560px] w-[560px] rounded-full"
        style={{ background: 'radial-gradient(circle, color-mix(in oklab, #8e9bf0 13%, transparent), transparent 70%)' } as CSSProperties}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-56 -right-48 h-[620px] w-[620px] rounded-full"
        style={{ background: 'radial-gradient(circle, color-mix(in oklab, #f0a9d6 11%, transparent), transparent 70%)' } as CSSProperties}
      />

      <div className="relative grid min-h-screen grid-cols-1 lg:grid-cols-[55fr_45fr]">
        {/* LEFT — emotional */}
        <div className="flex flex-col px-6 pt-10 sm:px-12 lg:px-16 lg:pt-14">
          <div className="mb-10 lg:mb-0">{brandLogo}</div>

          <div className="flex flex-1 flex-col justify-center pb-8 lg:pb-16">
            <h1 className="max-w-xl text-balance text-4xl font-light leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[64px]">
              {headline}
            </h1>
            <p className="mt-6 max-w-md text-base font-light leading-relaxed text-subtle sm:text-lg">
              {subheadline}
            </p>

            <div className="mt-12 flex justify-center lg:mt-14 lg:justify-start">
              <div className="h-44 w-44 sm:h-52 sm:w-52 lg:h-64 lg:w-64">
                <AiOrb />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — the form, directly on the page */}
        <div className="flex items-center justify-center px-6 pb-14 pt-4 sm:px-12 lg:px-16 lg:pb-0 lg:pt-0">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  )
}
