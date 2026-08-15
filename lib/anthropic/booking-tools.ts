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
    description: 'Book the appointment. Call this ONLY after the customer has explicitly confirmed the date and time and provided their name and phone number. Do not call it speculatively. For a job you travel to, ask for the street address BEFORE booking — but if the customer will not or cannot give one, BOOK ANYWAY with address left out and say you will confirm it later. Never ask a third time, and never refuse to book over a missing address.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        time: { type: 'string' },
        customer_name: { type: 'string' },
        customer_phone: { type: 'string' },
        service_type: { type: 'string' },
        // WHERE IT HAPPENS. An enum rather than free text, so the model cannot invent "in person" or
        // "Teams" — a fifth value would fail the column's CHECK and lose the booking.
        meeting_kind: { type: 'string', enum: ['on_site', 'zoom', 'google_meet', 'phone'], description: 'Where the appointment happens, from what the customer AGREED to. Never from what the service is called: a job named "Google Meet" that the customer expects you at their home is on_site. Default on_site when it was not discussed.' },
        address: { type: 'string', description: 'Street address for an on_site job, if the customer gave one. Leave it out rather than guessing.' },
        join_url: { type: 'string', description: 'The meeting link, ONLY if the customer gave you one. Never invent, guess or construct a link.' },
        duration_minutes: { type: 'number', description: 'Length in minutes, ONLY if a length was explicitly agreed. Leave it out otherwise.' },
      },
      // STILL just date and time. Every new field is optional on purpose: a required field the model
      // cannot fill means it does not call the tool at all, and a lost booking is worse than a gap
      // the agenda already shows in amber.
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
