'use client'

import { Printer } from 'lucide-react'

// Print / save-as-PDF via the browser. Hidden from the printed output itself (print:hidden).
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white print:hidden">
      <Printer className="h-4 w-4" /> Print / PDF
    </button>
  )
}
