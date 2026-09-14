// The customer opened a link that resolves to nothing: mistyped, truncated by a mail client, or
// never ours. No brand (there is no tenant to brand it as, and it must not be ours), no login, no
// navigation — one sentence and what to do.
export default function SharedDocumentNotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7f9', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 440, padding: 28, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#111827' }}>This document link is not available</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
          The link may be incomplete — some mail apps cut long links in two — or it may have been replaced.
          Please open it from the original email, or ask the business that sent it for a fresh link.
        </p>
      </div>
    </div>
  )
}
