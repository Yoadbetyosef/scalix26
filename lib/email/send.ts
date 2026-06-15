import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = 'Scalix <noreply@mylocksmithai.com>'

export async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping email')
    return { success: false, error: 'RESEND_API_KEY not set' }
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, html })
  if (error) {
    console.error('[email] send error:', error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

const INBOUND_FROM = 'noreply@mail.mylocksmithai.com'

// Send an AI reply to an inbound email. `from` is the agent's reply-from address
// (its domain must be verified in Resend); we also set it as Reply-To and fall
// back to the verified inbound domain so sends never break on an unverified From.
export async function sendEmailReply(to: string, from: string | null | undefined, subject: string, body: string, messageId?: string) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping reply')
    return { success: false, error: 'RESEND_API_KEY not set' }
  }
  const fromAddr = from || INBOUND_FROM
  const re = subject?.toLowerCase().startsWith('re:') ? subject : `Re: ${subject || 'your message'}`
  // Threading: reference the inbound Message-ID so replies thread in the client.
  const headers = messageId ? { 'In-Reply-To': messageId, References: messageId } : undefined
  const { error } = await resend.emails.send({
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
      if (!retry.error) return { success: true }
    }
    return { success: false, error: error.message }
  }
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
}
