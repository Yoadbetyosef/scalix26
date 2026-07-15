import { Resend } from 'resend'
import type { BrandData } from '@/lib/partner/brand'

const resend = new Resend(process.env.RESEND_API_KEY)
// The verified sending domain stays constant; the visible FROM NAME is the partner's brand, so the
// recipient never sees "Scalix". (Custom From domains are a future custom-domain concern.)
const SENDER_DOMAIN = 'noreply@scalix26.com'

// A clean, self-contained branded invitation. Uses the partner's logo, name, colors, and support
// details. Never references Scalix, the partner portal, commissions, or wholesale. "Powered by" only
// when the partner opted in.
export function renderInviteEmail(opts: { brand: BrandData; businessName: string; firstName?: string | null; acceptUrl: string }): string {
  const { brand, businessName, firstName, acceptUrl } = opts
  const accent = /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor || '') ? brand.primaryColor! : '#5B6CF0'
  const company = brand.name || 'Your AI Platform'
  const logo = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${company}" style="height:34px;max-width:180px;object-fit:contain" />`
    : `<div style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:${accent};color:#fff;font-weight:700;font-size:18px;font-family:Arial">${company.charAt(0).toUpperCase()}</div>`
  const hello = firstName ? `Hi ${firstName},` : 'Hi there,'
  const support = [brand.supportEmail, brand.supportPhone].filter(Boolean).join(' · ')
  const footer = brand.emailFooter || `© ${new Date().getFullYear()} ${company}`
  const poweredBy = brand.poweredByScalix ? ` · Powered by Scalix` : ''

  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:Arial,Helvetica,sans-serif;color:#1a1f36">
    <div style="max-width:520px;margin:0 auto;padding:32px 16px">
      <div style="margin-bottom:24px">${logo}</div>
      <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
        <h1 style="margin:0 0 8px;font-size:22px;color:#1a1f36">Your AI platform is ready</h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#4a5064">
          ${hello}<br/>Your team at <strong>${company}</strong> has set up <strong>${businessName}</strong> — an AI employee that answers calls, texts, and chats and books jobs 24/7. Create your password to sign in and manage your business.
        </p>
        <a href="${acceptUrl}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px">Create your password</a>
        <p style="margin:20px 0 0;font-size:12px;color:#8a90a2">This secure link expires in 14 days. If the button doesn't work, copy this URL:<br/><span style="color:#4a5064;word-break:break-all">${acceptUrl}</span></p>
      </div>
      <p style="margin:20px 0 0;font-size:12px;color:#8a90a2;text-align:center">${footer}${poweredBy}${support ? `<br/>Need help? ${support}` : ''}</p>
    </div>
  </body></html>`
}

export async function sendInviteEmail(opts: { brand: BrandData; to: string; businessName: string; firstName?: string | null; acceptUrl: string }) {
  if (!process.env.RESEND_API_KEY) { console.warn('[invite-email] RESEND_API_KEY not set — skipping'); return { success: false, error: 'no_key' } }
  const from = `${(opts.brand.name || 'Your AI Platform').replace(/[<>]/g, '')} <${SENDER_DOMAIN}>`
  const subject = `${opts.businessName} — your AI platform is ready`
  const { error } = await resend.emails.send({ from, to: opts.to, subject, html: renderInviteEmail(opts) })
  if (error) { console.error('[invite-email] send failed:', error); return { success: false, error: error.message } }
  return { success: true }
}
