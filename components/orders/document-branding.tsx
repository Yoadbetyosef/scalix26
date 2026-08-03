'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Palette } from 'lucide-react'
import { DocSettingsModal } from '@/components/studio/doc-settings-modal'

// Logo, brand colour, terms and quote validity for Estimates and Quotes — edited right from the document
// so what you change is visible immediately. Points the shared modal at the Orders-gated endpoints.
export function DocumentBranding({ needsLogo }: { needsLogo: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <span className="print:hidden">
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${needsLogo ? 'bg-amber-100 text-amber-900 hover:bg-amber-200' : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-50'}`}
      >
        <Palette className="h-4 w-4" /> {needsLogo ? 'Add your logo' : 'Branding'}
      </button>
      {open && (
        <DocSettingsModal
          settingsEndpoint="/api/orders/doc-settings"
          uploadEndpoint="/api/orders/logo-upload"
          onClose={() => setOpen(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </span>
  )
}
