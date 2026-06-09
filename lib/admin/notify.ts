import { sendEmail, emailTemplates } from '@/lib/email/send'
import twilio from 'twilio'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'yoadbetyosef@gmail.com'
const ADMIN_PHONE = process.env.ADMIN_PHONE || ''

async function sendAdminSMS(message: string) {
  if (!ADMIN_PHONE || !process.env.TWILIO_ACCOUNT_SID) return
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: ADMIN_PHONE,
    })
  } catch (err) {
    console.error('[admin sms]', err)
  }
}

export async function notifyAdminNewUser(user: {
  name: string; email: string; phone: string; plan: string
}) {
  const signupTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  const tmpl = emailTemplates.adminNewUser({ ...user, signupTime })
  await sendEmail(ADMIN_EMAIL, tmpl.subject, tmpl.html)
  await sendAdminSMS(
    `New signup: ${user.name} (${user.email}) — plan: ${user.plan} @ ${signupTime}`
  )
}

export async function notifyAdminPaymentFailed(user: {
  name: string; email: string; plan: string; amount: number
}) {
  const tmpl = emailTemplates.adminPaymentFailed(user)
  await sendEmail(ADMIN_EMAIL, tmpl.subject, tmpl.html)
  await sendAdminSMS(
    `Payment failed: ${user.name} (${user.email}) — $${(user.amount / 100).toFixed(2)}`
  )
}
