import type Anthropic from '@anthropic-ai/sdk'
import type { Skill } from '@/types'

// ── Financial Intent ─────────────────────────────────────────────────────────────
// A capability that groups every MONEY action the AI can take on behalf of the
// business. Today it has exactly one action — Payment Collection (send a secure Stripe
// payment link). It is designed as the foundation for future actions (deposits,
// remaining balance, invoices, financing, partial payments, refunds, subscriptions):
// each new action registers a tool in FINANCIAL_TOOLS + a branch in executeFinancialTool,
// with no changes to the pipeline.
//
// HARD GUARANTEES:
//  • Available ONLY when the payment_collection skill is ON *and* Stripe Connect is active.
//  • The AI can never invent a price — it may only pass an exact price_id from the injected
//    catalog, and the backend re-validates that the price belongs to the connected account.
//  • Approval + Checkout live entirely in the existing backend; this layer only decides
//    WHEN/HOW the AI reaches for it.

// Broad phrase net for recognising payment intent. This is only used to decide whether to
// enter the tool turn — the model + tool descriptions make the final call.
const FINANCIAL_PHRASES = [
  'pay', 'payment', 'pay now', 'ready to pay', 'i can pay', 'pay by card', 'by card', 'credit card',
  'invoice', 'send me an invoice', 'bill me', 'deposit', 'how can i pay', 'how do i pay',
  'make a payment', 'checkout', 'charge me',
  // es
  'pagar', 'pago', 'factura', 'depósito', 'deposito', 'tarjeta',
]

export function detectFinancialIntent(text: string): boolean {
  const t = ` ${text.toLowerCase()} `
  return FINANCIAL_PHRASES.some((p) => t.includes(p))
}

// Pure availability check — reads the already-loaded skills + tenant, no extra queries.
export function isFinancialCapabilityAvailable(
  skills: Skill[],
  tenant: { stripe_connect_status?: string | null; stripe_connect_account_id?: string | null } | null | undefined,
): boolean {
  const skillOn = skills.some((s) => s.type === 'payment_collection' && s.active)
  const connected = tenant?.stripe_connect_status === 'connected' && !!tenant?.stripe_connect_account_id
  return skillOn && connected
}

// ── Actions (today: Payment Collection) ──────────────────────────────────────────
export const FINANCIAL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'send_payment_link',
    description:
      "Send the customer a secure Stripe payment link for one of the business's real products. " +
      'Use ONLY a price_id from the PAYMENTS list in your instructions — NEVER invent a price or amount. ' +
      "Confirm which product/service the customer is paying for first. If several products exist and it's " +
      "unclear, ask which one. If the amount depends on an estimate you don't have, ask which estimate they mean.",
    input_schema: {
      type: 'object',
      properties: {
        price_id: { type: 'string', description: 'The EXACT price_id from the PAYMENTS product list in your instructions' },
        customer_email: { type: 'string', description: "Customer's email to send the link to, if known" },
      },
      required: ['price_id'],
    },
  },
]

export function isFinancialTool(name: string): boolean {
  return FINANCIAL_TOOLS.some((t) => t.name === name)
}

export interface FinancialToolCtx {
  leadToken: string
  channel: string
  customerPhoneFallback: string | null
  appUrl: string
  conversationId?: string | null
  contactId?: string | null
}

// Execute one financial tool → returns a short string for the model's tool_result. NEVER
// throws. Calls the EXISTING payment-link route (skill + approval + Stripe live there).
export async function executeFinancialTool(name: string, input: Record<string, unknown>, ctx: FinancialToolCtx): Promise<string> {
  try {
    if (name === 'send_payment_link') {
      const priceId = typeof input.price_id === 'string' ? input.price_id.trim() : ''
      if (!priceId) return 'Ask the customer which product/service they want to pay for, then send the link using its price_id.'
      const customerEmail = typeof input.customer_email === 'string' && input.customer_email.trim() ? input.customer_email.trim() : null
      const r = await fetch(`${ctx.appUrl}/api/stripe/connect/payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_token: ctx.leadToken,
          price_id: priceId,
          customer_email: customerEmail,
          customer_phone: ctx.customerPhoneFallback,
          conversation_id: ctx.conversationId,
          contact_id: ctx.contactId,
          channel: ctx.channel,
        }),
      })
      const j = (await r.json().catch(() => ({}))) as { url?: string; productName?: string; emailed?: boolean; pending?: boolean; message?: string; error?: string }
      // Approval required → the backend created a pending request, NOT a Checkout Session.
      if (j.pending) return j.message || "I've prepared the payment request — the business owner will review and approve it shortly. Let the customer know it's on the way."
      if (!r.ok || !j.url) return `Could not create a payment link: ${j.error || 'please try again'}`
      return j.emailed
        ? `Payment link for ${j.productName} emailed to the customer. Let them know it's on its way; you can also share this link: ${j.url}`
        : `Payment link for ${j.productName} created. Share this secure link with the customer: ${j.url}`
    }
    return `Unknown financial tool: ${name}`
  } catch (e) {
    console.error('[financial-intent] execute failed:', e instanceof Error ? e.message : e)
    return 'That payment action did not go through. Offer to have someone follow up.'
  }
}

// The prompt block injected ONLY when the capability is available. Teaches the AI when to
// reach for a payment, the safety rules, the approval expectation, and the real catalog.
export function financialIntentPrompt(opts: { catalogLine: string; requireApproval: boolean }): string {
  const approval = opts.requireApproval
    ? "- Payments need the business owner's approval. When the customer wants to pay, use send_payment_link — the system will create the request and the owner approves it. Tell the customer you're preparing the payment and the owner will confirm it shortly."
    : '- When the customer wants to pay, use send_payment_link and share the secure link that comes back.'
  return `FINANCIAL INTENT — the customer may want to pay (e.g. "I'm ready to pay", "can I pay now", "send me a payment link", "send me an invoice", "I'll pay the deposit", "pay by card", "how can I pay").
${approval}
- NEVER invent a price or amount. Only send a payment for a real product using its exact price_id from the list below.
- If it's unclear WHAT they're paying for, ask which product/service. If the amount depends on an estimate you don't have, ask which estimate they mean — never guess.
- Only bring up payment when the customer does, or when they clearly want to pay. Don't push it.
${opts.catalogLine ? `\n${opts.catalogLine}` : '\n(No payable products are set up yet — if the customer wants to pay, tell them someone will follow up with details.)'}`
}
