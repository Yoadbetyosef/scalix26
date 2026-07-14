import { getApprovalByToken } from '@/lib/orders/approvals'
import { PublicApprovalForm } from '@/components/orders/public-approval'

export const dynamic = 'force-dynamic'

// PUBLIC approval page — reachable only with a valid token. No tenant data, internal notes, internal IDs, or
// other orders are ever exposed. Invalid/expired/revoked tokens get a single generic page.
function Unavailable() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7f9', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 440, padding: 28, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#111827' }}>Link unavailable</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>This approval link is invalid, has expired, or is no longer available. If you believe this is a mistake, please contact the sender.</p>
      </div>
    </div>
  )
}

export default async function ApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token
  const view = await getApprovalByToken(token)
  if (!view) return <Unavailable />

  const specs = (l: { measurements: string | null; color: string | null; material: string | null; customSpec: string | null }) => [l.measurements, l.color, l.material, l.customSpec].filter(Boolean).join(' · ')
  const responded = ['approved', 'changes_requested', 'rejected'].includes(view.status)

  return (
    <div style={{ minHeight: '100vh', background: '#f6f7f9', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{view.businessName}</div>
          <h1 style={{ fontSize: 22, margin: '8px 0 2px', color: '#111827' }}>Order {view.order.orderNumber}</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>You are reviewing this order as the {view.approvalType}.{view.deadline ? ` Please respond by ${new Date(view.deadline).toLocaleDateString()}.` : ''}</p>
          {view.order.customerName && <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>Customer: {view.order.customerName}</p>}

          <h2 style={{ fontSize: 14, margin: '20px 0 8px', color: '#111827' }}>Items</h2>
          <div style={{ border: '1px solid #eef0f2', borderRadius: 10, overflow: 'hidden' }}>
            {view.order.lineItems.map((l, i) => (
              <div key={i} style={{ padding: 12, borderTop: i ? '1px solid #f1f2f4' : 'none' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{l.productName} <span style={{ fontWeight: 400, color: '#6b7280' }}>× {l.quantity}</span></div>
                {l.description && <div style={{ fontSize: 13, color: '#6b7280' }}>{l.description}</div>}
                {specs(l) && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{specs(l)}</div>}
              </div>
            ))}
            {view.order.lineItems.length === 0 && <div style={{ padding: 12, fontSize: 13, color: '#9ca3af' }}>No items listed.</div>}
          </div>

          {view.order.publicNotes && <><h2 style={{ fontSize: 14, margin: '18px 0 6px', color: '#111827' }}>Notes</h2><p style={{ fontSize: 13, color: '#4b5563', margin: 0 }}>{view.order.publicNotes}</p></>}

          {view.attachments.length > 0 && <><h2 style={{ fontSize: 14, margin: '18px 0 6px', color: '#111827' }}>Attachments</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{view.attachments.map((a, i) => <li key={i} style={{ fontSize: 13 }}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{a.fileName}</a> : a.fileName}</li>)}</ul></>}

          {responded && <div style={{ marginTop: 18, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 13, color: '#166534' }}>Your response was recorded: <strong>{view.status.replace('_', ' ')}</strong>.{view.existingResponse?.comment ? ` "${view.existingResponse.comment}"` : ''} You can update it below if needed.</div>}

          <h2 style={{ fontSize: 14, margin: '20px 0 8px', color: '#111827' }}>Your decision</h2>
          {view.canRespond ? <PublicApprovalForm token={token} approvalType={view.approvalType} /> : <p style={{ fontSize: 13, color: '#9ca3af' }}>This request is no longer open for responses.</p>}
        </div>
        <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', margin: '14px 0 0' }}>Secure approval link · {view.businessName}</p>
      </div>
    </div>
  )
}
