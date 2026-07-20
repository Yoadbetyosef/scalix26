'use client'

import { Printer, X } from 'lucide-react'

// Thin bar shown only on the internal preview (never on the customer page). Print → browser Save-as-PDF.
export function ProposalPreviewBar() {
  return (
    <div className="print:hidden" style={{ maxWidth: 720, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#111827', color: '#fff', borderRadius: 12, padding: '10px 16px' }}>
      <span style={{ fontSize: 13 }}>Internal preview — this is exactly what the customer sees. No view is recorded.</span>
      <span style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#111827', border: 0, borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}><Printer style={{ width: 15, height: 15 }} /> Print / PDF</button>
        <button onClick={() => window.close()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }} aria-label="Close"><X style={{ width: 15, height: 15 }} /></button>
      </span>
    </div>
  )
}
