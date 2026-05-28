'use client'

import { Toaster as Sonner } from 'sonner'

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#fff',
          border: '1px solid #e5e7eb',
          color: '#111827',
        },
      }}
    />
  )
}
