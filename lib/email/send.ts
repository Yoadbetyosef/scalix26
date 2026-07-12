import { Resend } from 'resend'
import { meterUsage } from '@/lib/billing/meter'
import { RATE_RESEND_EMAIL } from '@/lib/cost/rates'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = 'Scalix <noreply@mylocksmithai.com>'

// Optional billing context — when a tenant is in scope, the send is metered (Resend id = the
// deterministic resource id, quantity = 1 message).
export interface EmailMeta { tenantId?: string; customerId?: string | null }

function meterEmail(id: string | undefined, meta?: EmailMeta) {
  if (!meta?.tenantId || !id) return
  meterUsage({
    tenantId: meta.tenantId, customerId: meta.customerId ?? null,
    category: 'email', provider: 'resend', metric: 'email',
    quantity: 1, providerCostUsd: RATE_RESEND_EMAIL, resourceId: id, kind: 'email',
  })
}

export async function sendEmail(to: string, subject: string, html: string, meta?: EmailMeta) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping email')
    return { success: false, error: 'RESEND_API_KEY not set' }
  }
  const { data, error } = await resend.emails.send({ from: FROM, to, subject, html })
  if (error) {
    console.error('[email] send error:', error)
    return { success: false, error: error.message }
  }
  meterEmail(data?.id, meta)
  return { success: true }
}

const INBOUND_FROM = 'noreply@mail.mylocksmithai.com'

// Send an AI reply to an inbound email. `from` is the agent's reply-from address
// (its domain must be verified in Resend); we also set it as Reply-To and fall
// back to the verified inbound domain so sends never break on an unverified From.
export async function sendEmailReply(to: string, from: string | null | undefined, subject: string, body: string, messageId?: string, meta?: EmailMeta) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping reply')
    return { success: false, error: 'RESEND_API_KEY not set' }
  }
  const fromAddr = from || INBOUND_FROM
  const re = subject?.toLowerCase().startsWith('re:') ? subject : `Re: ${subject || 'your message'}`
  // Threading: reference the inbound Message-ID so replies thread in the client.
  const headers = messageId ? { 'In-Reply-To': messageId, References: messageId } : undefined
  const { data, error } = await resend.emails.send({
    from: fromAddr,
    to,
    replyTo: from || undefined,
    subject: re,
    text: body,
    headers,
  })
  if (error) {
    console.error('[email] reply send error:', error)
    if (from && from !== INBOUND_FROM) {
      const retry = await resend.emails.send({ from: INBOUND_FROM, to, replyTo: from, subject: re, text: body, headers })
      if (!retry.error) { meterEmail(retry.data?.id, meta); return { success: true } }
    }
    return { success: false, error: error.message }
  }
  meterEmail(data?.id, meta)
  return { success: true }
}

export const emailTemplates = {
  paymentFailed: (name: string, updateUrl: string) => ({
    subject: "We couldn't process your payment",
    html: `<p>Hi ${name},</p>
<p>We weren't able to process your payment. Please update your card to keep your account active.</p>
<p><a href="${updateUrl}" style="background:#4ecdc4;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">Update Payment Method</a></p>
<p>If you have any questions, reply to this email.</p>`,
  }),

  paymentSuccess: (name: string, amount: number, date: string) => ({
    subject: 'Payment confirmed — receipt',
    html: `<p>Hi ${name},</p>
<p>Your payment of <strong>$${(amount / 100).toFixed(2)}</strong> was processed successfully on ${date}.</p>
<p>Thank you for using Scalix!</p>`,
  }),

  cardUpdated: (name: string) => ({
    subject: 'Your payment method has been updated',
    html: `<p>Hi ${name},</p>
<p>Your payment method has been updated successfully. Your next billing cycle will use the new card on file.</p>`,
  }),

  trialEnding: (name: string, daysLeft: number, upgradeUrl: string) => ({
    subject: `Your free trial ends in ${daysLeft} days`,
    html: `<p>Hi ${name},</p>
<p>Your free trial ends in <strong>${daysLeft} days</strong>. You won't be charged if you cancel before then.</p>
<p><a href="${upgradeUrl}" style="background:#4ecdc4;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">Upgrade Now</a></p>`,
  }),

  subscriptionCancelled: (name: string) => ({
    subject: "Your account has been cancelled",
    html: `<p>Hi ${name},</p>
<p>Your Scalix subscription has been cancelled. We're sorry to see you go.</p>
<p>Your data will be retained for 30 days. If you'd like to reactivate, just sign back in.</p>`,
  }),

  appointmentBooked: (a: { business: string; customer: string; when: string; phone: string; service: string; email?: string | null; channel?: string | null }) => ({
    subject: `New appointment: ${a.customer} — ${a.when}`,
    html: `<h2>New appointment booked</h2>
<p>Your AI just booked an appointment${a.channel ? ` via ${a.channel}` : ''} for ${a.business}.</p>
<table>
<tr><td><strong>Customer</strong></td><td>${a.customer}</td></tr>
<tr><td><strong>When</strong></td><td>${a.when}</td></tr>
<tr><td><strong>Phone</strong></td><td>${a.phone}</td></tr>
${a.email ? `<tr><td><strong>Email</strong></td><td>${a.email}</td></tr>` : ''}
<tr><td><strong>Service</strong></td><td>${a.service}</td></tr>
</table>`,
  }),

  adminNewUser: (user: { name: string; email: string; phone: string; plan: string; signupTime: string }) => ({
    subject: `New signup: ${user.name}`,
    html: `<h2>New user signed up</h2>
<table>
<tr><td><strong>Name</strong></td><td>${user.name}</td></tr>
<tr><td><strong>Email</strong></td><td>${user.email}</td></tr>
<tr><td><strong>Phone</strong></td><td>${user.phone || '—'}</td></tr>
<tr><td><strong>Plan</strong></td><td>${user.plan}</td></tr>
<tr><td><strong>Signed up</strong></td><td>${user.signupTime}</td></tr>
</table>`,
  }),

  adminPaymentFailed: (user: { name: string; email: string; plan: string; amount: number }) => ({
    subject: `Payment failed: ${user.name}`,
    html: `<h2>Payment Failed</h2>
<table>
<tr><td><strong>User</strong></td><td>${user.name}</td></tr>
<tr><td><strong>Email</strong></td><td>${user.email}</td></tr>
<tr><td><strong>Plan</strong></td><td>${user.plan}</td></tr>
<tr><td><strong>Amount</strong></td><td>$${(user.amount / 100).toFixed(2)}</td></tr>
</table>`,
  }),

  // ── Partner OS ──────────────────────────────────────────────────────────
  partnerInvite: (company: string, role: string, joinUrl: string) => ({
    subject: `You're invited to join ${company} on Scalix26`,
    html: `<p>Hi,</p>
<p>You've been invited to join <strong>${company}</strong> as <strong>${role}</strong> on the Scalix26 Partner platform.</p>
<p><a href="${joinUrl}" style="background:#5B6CF0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Accept invitation</a></p>
<p>Sign in with this email and you'll be added automatically.</p>`,
  }),

  partnerConversion: (name: string, dashboardUrl: string) => ({
    subject: 'A referral just converted to paid! 🎉',
    html: `<p>Hi ${name},</p>
<p>Great news — one of the customers you referred just started a <strong>paid subscription</strong>. Your recurring commission has started.</p>
<p><a href="${dashboardUrl}" style="background:#5B6CF0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">View commissions</a></p>`,
  }),

  partnerPayout: (name: string, amount: number, currency: string, dashboardUrl: string) => ({
    subject: `Your payout of ${(amount / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() })} is on the way 💸`,
    html: `<p>Hi ${name},</p>
<p>We've issued a payout of <strong>${(amount / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() })}</strong> for your Scalix26 partner commissions.</p>
<p><a href="${dashboardUrl}" style="background:#5B6CF0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">View statement</a></p>`,
  }),

  partnerDemo: (business: string, demoUrl: string) => ({
    subject: `See your AI employee in action — ${business}`,
    html: `<p>Hi,</p>
<p>We built a live demo of an AI employee for <strong>${business}</strong>. It answers calls, texts, and questions 24/7 — try chatting with it:</p>
<p><a href="${demoUrl}" style="background:#5B6CF0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Try your AI demo</a></p>
<p>${demoUrl}</p>`,
  }),

  balanceLow: (name: string, amount: number, currency: string, balanceUrl: string) => ({
    subject: 'Your Scalix balance is running low',
    html: `<p>Hi ${name},</p>
<p>Your account balance is down to <strong>${(amount / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() })}</strong>. Top up soon to keep your clients' voice, messaging, and AI running without interruption.</p>
<p><a href="${balanceUrl}" style="background:#5B6CF0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Add balance</a></p>`,
  }),

  balancePaused: (name: string, balanceUrl: string) => ({
    subject: 'Action needed: your Scalix balance is empty',
    html: `<p>Hi ${name},</p>
<p>Your account balance has run out, so new voice calls, messages, and AI replies for your clients are <strong>paused</strong>. Your data and settings are safe — top up to resume service right away.</p>
<p><a href="${balanceUrl}" style="background:#5B6CF0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Top up now</a></p>`,
  }),
}
