import type Anthropic from '@anthropic-ai/sdk'

// Anthropic tool definitions for the TEXT pipeline (SMS / Instagram / Facebook),
// mirroring the voice-server's check_availability + book_appointment functions. The
// executor calls the SAME /api/appointments/available and /api/appointments/book
// endpoints voice uses — so persistence, no-double-booking (23505), notifications,
// and the Google Calendar event all come for free.

export const BOOKING_TOOLS: Anthropic.Tool[] = [
  {
    name: 'check_availability',
    description: 'Check which appointment times are open on a given date BEFORE offering times to the customer. Use the customer\'s preferred date.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date like tomorrow, Monday, June 15' },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book the appointment. Call this ONLY after the customer has explicitly confirmed the date and time and provided their name and phone number. Do not call it speculatively.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        time: { type: 'string' },
        customer_name: { type: 'string' },
        customer_phone: { type: 'string' },
        service_type: { type: 'string' },
      },
      required: ['date', 'time'],
    },
  },
]

export interface BookingToolCtx {
  leadToken: string
  channel: string // 'sms' | 'instagram' | 'facebook'
  customerPhoneFallback: string | null // the SMS sender's number; null for IG/FB
  appUrl: string
  conversationId?: string | null // for attributing a payment to the conversation
  contactId?: string | null
}

// Execute one tool call and return a short string for the model's tool_result.
// NEVER throws — any failure returns a graceful message so the pipeline can't crash.
export async function executeBookingTool(
  name: string,
  input: Record<string, unknown>,
  ctx: BookingToolCtx,
): Promise<string> {
  try {
    if (!ctx.leadToken) return 'Booking is not set up for this account yet. Offer to have someone follow up.'

    if (name === 'check_availability') {
      const date = typeof input.date === 'string' ? input.date : ''
      const r = await fetch(
        `${ctx.appUrl}/api/appointments/available?lead_token=${encodeURIComponent(ctx.leadToken)}&date=${encodeURIComponent(date)}`,
      )
      const j = (await r.json().catch(() => ({}))) as { slots?: string[]; date?: string; error?: string }
      if (!j.slots || j.slots.length === 0) return `No open times on ${date || 'that date'}. Ask the customer for another date.`
      return `Open times on ${j.date}: ${j.slots.join(', ')}`
    }

    if (name === 'book_appointment') {
      const argPhone = typeof input.customer_phone === 'string' && input.customer_phone.trim() ? input.customer_phone.trim() : null
      const phone = argPhone || ctx.customerPhoneFallback
      if (!phone) return 'Missing the customer phone number — ask the customer for their phone number, then book.'

      const r = await fetch(`${ctx.appUrl}/api/appointments/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          lead_token: ctx.leadToken,
          customer_phone: phone,
          channel: ctx.channel,
          // SMS already confirms in-channel via text — don't also send /book's SMS.
          suppress_customer_sms: ctx.channel === 'sms',
        }),
      })
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string }
      return j.success ? 'Appointment booked successfully.' : `Could not book: ${j.error || 'please try again'}`
    }

    return `Unknown tool: ${name}`
  } catch (e) {
    console.error('[booking-tools] execute failed:', e instanceof Error ? e.message : e)
    return 'The booking system is temporarily unavailable. Apologize and offer to have someone follow up shortly.'
  }
}
