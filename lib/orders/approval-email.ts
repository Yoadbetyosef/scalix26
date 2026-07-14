import type { ApprovalType } from './stages'

// Transactional approval email. Branded, references the order, states the requested action + deadline, and a
// single secure "Review & Respond" button. Deliberately contains NO full order details — those live behind the
// token page. Plain string building (no PII beyond the recipient's own context).
const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))

export function approvalEmailHtml(p: { businessName: string; orderNumber: string; approvalType: ApprovalType; message: string | null; deadline: string | null; link: string; supportEmail: string | null }): string {
  const who = p.approvalType === 'factory' ? 'factory/supplier' : 'customer'
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
      <div style="font-size:14px;font-weight:600;color:#374151">${esc(p.businessName)}</div>
      <h1 style="font-size:20px;margin:12px 0 6px">Approval requested</h1>
      <p style="font-size:14px;color:#4b5563;margin:0 0 4px">You've been asked to review order <strong>${esc(p.orderNumber)}</strong> as the ${who}.</p>
      ${p.deadline ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px">Please respond by <strong>${esc(p.deadline)}</strong>.</p>` : ''}
      ${p.message ? `<div style="font-size:14px;color:#374151;background:#f9fafb;border-radius:10px;padding:12px;margin:0 0 16px">${esc(p.message)}</div>` : ''}
      <a href="${p.link}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:10px">Review &amp; Respond</a>
      <p style="font-size:12px;color:#9ca3af;margin:18px 0 0">On the secure page you can Approve, Request Changes, or Reject and add a comment. The full order details and any shared files are shown there — not in this email.</p>
      ${p.supportEmail ? `<p style="font-size:12px;color:#9ca3af;margin:8px 0 0">Questions? Contact ${esc(p.supportEmail)}.</p>` : ''}
    </div>
    <p style="font-size:11px;color:#9ca3af;text-align:center;margin:14px 0 0">If you didn't expect this, you can ignore this email.</p>
  </div></body></html>`
}
