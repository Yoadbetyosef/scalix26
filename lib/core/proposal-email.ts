// Branded proposal email. Uses the tenant's business name + reply-to; contains a short summary, product
// thumbnails, total and expiry, and ONE secure "View proposal" button. The full proposal (all lines,
// attributes, terms) lives behind the token page — deliberately NOT dumped into the email body.
const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))

export interface ProposalEmailInput {
  businessName: string
  customerName: string | null
  proposalNumber: string
  summary: string | null
  thumbnails: string[]          // absolute image URLs (best-effort; may be empty)
  totalFormatted: string
  expiresOn: string | null      // YYYY-MM-DD
  link: string                  // secure token URL (raw token only here)
  supportEmail: string | null
}

export function proposalEmailHtml(p: ProposalEmailInput): string {
  const thumbs = p.thumbnails.slice(0, 4).map((u) =>
    `<img src="${u}" width="72" height="72" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb;margin:0 6px 6px 0" />`).join('')
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
      <div style="font-size:14px;font-weight:600;color:#374151">${esc(p.businessName)}</div>
      <h1 style="font-size:20px;margin:12px 0 6px">Your proposal is ready</h1>
      <p style="font-size:14px;color:#4b5563;margin:0 0 4px">${p.customerName ? `Hi ${esc(p.customerName)}, ` : ''}we've prepared proposal <strong>${esc(p.proposalNumber)}</strong> for you.</p>
      ${p.summary ? `<p style="font-size:14px;color:#374151;margin:8px 0 0">${esc(p.summary)}</p>` : ''}
      ${thumbs ? `<div style="margin:16px 0 4px">${thumbs}</div>` : ''}
      <div style="font-size:15px;color:#111827;margin:14px 0 4px"><strong>Total: ${esc(p.totalFormatted)}</strong></div>
      ${p.expiresOn ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px">Valid until <strong>${esc(p.expiresOn)}</strong>.</p>` : '<div style="height:8px"></div>'}
      <a href="${p.link}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:10px">View proposal</a>
      <p style="font-size:12px;color:#9ca3af;margin:18px 0 0">On the secure page you can review every item, accept or decline, and download a PDF. This link is private to you.</p>
      ${p.supportEmail ? `<p style="font-size:12px;color:#9ca3af;margin:8px 0 0">Questions? Reply to this email or contact ${esc(p.supportEmail)}.</p>` : ''}
    </div>
    <p style="font-size:11px;color:#9ca3af;text-align:center;margin:14px 0 0">If you didn't expect this, you can ignore this email.</p>
  </div></body></html>`
}
