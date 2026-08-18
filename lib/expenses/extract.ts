import { nullable, readDocument } from '@/lib/anthropic/read-document'
import { CATEGORIES, CATEGORY_KEYS } from './categories'
import { addDays, parseAmountCents } from './schema'

// READING A RECEIPT.
//
// The sibling of lib/invoices/extract.ts, sharing everything except a schema and a prompt — the call
// itself is in lib/anthropic/read-document.ts. What differs is not the machinery, it is what a
// receipt IS: an invoice is a table whose columns have to be followed across a page, and a receipt is
// four facts on a crumpled piece of thermal paper.
//
// ── WHAT THIS IS FOR, AND WHAT IT IS NOT ────────────────────────────────────────────────────────
//
// Typing the amount, the merchant and the category off a receipt already in your hand is the work.
// Skipping it is the whole point of the feature. So this fills the form; it does not save anything,
// and nothing here writes a row. The person checks four fields against the paper and presses save —
// which is also why this file may return nulls freely and must never return a guess.
//
// ── MODEL AND EFFORT ────────────────────────────────────────────────────────────────────────────
//
// Sonnet 5, like the invoice reader, but at LOW effort where that one uses medium. The invoice is
// following a column across fifteen pages and deciding which number is a unit price; this is reading
// four fields off one page. Effort buys deliberation, deliberation is thinking tokens, and thinking
// tokens are most of the time a person spends staring at the sheet. See RECEIPT_EFFORT.
//
// Haiku would be about a quarter of the price and is a real option. It is not the one taken, for a
// reason that is NOT the invoice reader's: there, a weak read produces a wrong number nobody catches.
// Here the person is holding the receipt, so a weak read produces a BLANK, and a reader that fills
// two fields of four is a reader nobody bothers to wait for. The measure is fill rate on real
// receipts, and the meter already records what each read cost — change the model when that data
// exists, not before.

export const RECEIPT_MODEL = 'claude-sonnet-5'

/** Four fields off one page. Deliberation here buys nothing and costs the person seconds. */
export const RECEIPT_EFFORT = 'low' as const

/**
 * Money comes back as the PRINTED TEXT, not as a number.
 *
 * A float would go through this codebase's one rule about money — integer cents, because a float puts
 * rounding drift into a tax return. Returning "42.50" and passing it through parseAmountCents, which
 * the manual form already uses and which is already tested, means there is exactly one function in
 * this application that turns something a human wrote into cents. The model transcribing rather than
 * converting is also the weaker and therefore safer request.
 */
const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'merchant', 'totalText', 'taxText', 'datePrinted', 'spentOn', 'currency', 'category'],
  properties: {
    /**
     * Three outcomes, because "I photographed my dog" and "the print has faded" need different
     * sentences. Without this, both arrive as a row of nulls and the screen has to call them the
     * same thing — which makes a mis-tap look like a broken feature.
     */
    readable: { type: 'string', enum: ['receipt', 'unreadable', 'not_a_receipt'] },
    merchant: nullable('string'),
    /** The total actually paid, exactly as printed. */
    totalText: nullable('string'),
    /** GST/HST/VAT if the receipt names one. Null when it does not — never computed. */
    taxText: nullable('string'),
    /** The date as PRINTED — "03/04/26", "4 Mar 2026". Shown to the person beside the date field. */
    datePrinted: nullable('string'),
    /** The same date as YYYY-MM-DD, or null when it cannot be resolved. */
    spentOn: nullable('string'),
    currency: nullable('string'),
    /** One of the eighteen keys, or null. Not a free-text guess — see the enum below. */
    category: { anyOf: [{ type: 'string', enum: CATEGORY_KEYS }, { type: 'null' }] },
  },
}

interface RawReceipt {
  readable: 'receipt' | 'unreadable' | 'not_a_receipt'
  merchant: string | null
  totalText: string | null
  taxText: string | null
  datePrinted: string | null
  spentOn: string | null
  currency: string | null
  category: string | null
}

/**
 * The prompt.
 *
 * The category list is inlined WITH ITS HINTS because the hints are how a person is told what belongs
 * where, and the model is being asked the same question a person is. Built from CATEGORIES rather
 * than written out, so a category added to the list is a category the reader knows about — a second
 * copy here would be the reader quietly refusing to suggest the newest one.
 *
 * ── THE TWO LINES ABOUT A RECEIPT WITH NO TOTAL ON IT ───────────────────────────────────────────
 *
 * Those two rules are not tidiness, they were measured. Photographing the top half of a long receipt
 * is the single most likely way to get a wrong number into this form, and without them the reader
 * returns a LINE ITEM as the total — on a fuel receipt cut just below "FUEL 71.80", it confidently
 * answered 71.80 for a receipt whose real total was 87.99. That is not a hallucination; the number is
 * printed on the page, which is exactly what makes it dangerous. It arrives pre-filled and looks
 * right.
 *
 * "even when it is the only one you can see" is the clause doing the work, and it was tried both
 * ways: softening it to allow for a plainly-complete one-line receipt brought 71.80 straight back on
 * both runs. Kept strict, and checked that it does not over-refuse — a parking scrap reading
 * "4 HRS 12.00" and nothing else still returns 12.00, three runs out of three. If somebody comes back
 * to soften this, that is the pair to re-run first.
 */
const PROMPT = `You are reading a photograph of a receipt for a small business owner who is recording what they spent. They are holding the receipt and will check every field you return, so a blank is cheap and a wrong number is expensive.

Return:
- merchant: who was paid. The trading name on the receipt, not the legal entity in the small print, and not the address.
- totalText: the amount ACTUALLY PAID, exactly as printed, digits only with a decimal point ("42.50"). This is the bottom line — after any discount, and on a card slip the TOTAL rather than the subtotal or the tip line. If more than one total is printed, take the one the customer paid.
- taxText: sales tax, GST, HST or VAT if the receipt states one as a separate amount, exactly as printed. Null if it does not. Never calculate it.
- datePrinted: the transaction date exactly as it appears on the paper, in its own format.
- spentOn: that same date as YYYY-MM-DD. If the receipt shows a purely numeric date whose day/month order is genuinely ambiguous, still give your best reading here — datePrinted is what lets the person catch it.
- currency: the ISO code (USD, CAD, EUR, GBP) if the receipt shows one or a symbol that settles it. Null if nothing on the page says.
- category: the single best fit from this list, or null if you are not reasonably confident:
${CATEGORIES.map((c) => `  ${c.key} — ${c.label}${c.hint ? `: ${c.hint}` : ''}`).join('\n')}
- readable: "receipt" if this is a receipt or invoice you could read at all; "unreadable" if it is one but the print is too faded, blurred or cut off to get the fields from; "not_a_receipt" if the photograph is of something else entirely.

Rules:
- Transcribe. Do not calculate, correct or reconcile anything.
- NEVER GUESS AN AMOUNT. If the total is illegible, torn off or ambiguous, return null. A blank asks the person a question; a wrong number gets waved through.
- If no total is printed on the part of the receipt you can see — the bottom is cut off, out of frame, torn, or hidden — totalText is null. Do NOT add the line items up, and do NOT promote a line item, a subtotal or the largest number on the page to being the total. A photograph that missed the bottom of a long receipt is the ordinary case, not a strange one.
- An amount counts as the total when the receipt says so: labelled TOTAL, AMOUNT DUE, BALANCE, PAID or similar, or shown as the amount taken on the card or cash payment line. An amount printed against the name of a product or service — FUEL, a dish, a part number — is a LINE ITEM, not the total, even when it is the last thing you can see and even when it is the only one you can see.
- Use null for anything genuinely absent or unreadable. Never substitute 0 — 0 means the receipt says zero.
- Read a partial receipt as far as it goes. Three fields and a null is a good answer; do not withhold what you could read because something else was missing.`

/** What the screen is given. Cents, because that is what the form and the row already speak. */
export interface ReceiptReading {
  readable: 'receipt' | 'unreadable' | 'not_a_receipt'
  merchant: string | null
  amountCents: number | null
  taxCents: number | null
  /** ISO, or null. Null means the date field stays EMPTY — see resolveSpentOn. */
  spentOn: string | null
  /** As printed, shown beside the date so a swapped day and month is catchable at a glance. */
  datePrinted: string | null
  currency: string | null
  category: string | null
}

/**
 * The date, or nothing.
 *
 * ── BLANK ASKS, TODAY ASSERTS ───────────────────────────────────────────────────────────────────
 *
 * The manual form defaults to today, which is a reasonable guess when nobody has looked at the paper.
 * Once a photograph HAS been read, that default becomes a claim — and the first real complaint about
 * this screen was exactly that: an old receipt entered and silently dated today. So a date this
 * function cannot stand behind comes back null, the field is left empty, and the person is asked.
 *
 * What it refuses: anything that is not an ISO date; anything the calendar rejects (2026-02-31);
 * anything past tomorrow, matching parseExpense's own tolerance, since a receipt dated in the future
 * is a misread year far more often than it is a real thing.
 *
 * What it does NOT refuse: old dates. A shoebox of eighteen-month-old receipts is the case this
 * feature exists for, and a rule against them would refuse its own best use.
 */
export function resolveSpentOn(raw: string | null, today: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  // Round-trip through UTC: Date.parse accepts 2026-02-31 and quietly hands back 3 March.
  const d = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null
  if (raw > addDays(today, 1)) return null
  return raw
}

/** Three letters or nothing. */
const currencyOf = (raw: string | null): string | null => {
  const code = raw?.trim().toUpperCase() ?? ''
  return /^[A-Z]{3}$/.test(code) ? code : null
}

/**
 * Fold a raw reading into what the screen uses.
 *
 * Pure and exported so the rules above are testable without an API call — every one of them is a rule
 * about what NOT to fill in, and those are the ones worth pinning.
 */
export function shapeReading(raw: RawReceipt, today: string): ReceiptReading {
  const amountCents = raw.totalText ? parseAmountCents(raw.totalText) : null
  const taxRaw = raw.taxText ? parseAmountCents(raw.taxText) : null

  // Tax that is not smaller than the total is a misread, not a discovery — parseExpense would refuse
  // it at save time anyway, and offering it would put a field on screen that cannot be saved.
  const taxCents = taxRaw !== null && amountCents !== null && taxRaw < amountCents ? taxRaw : null

  return {
    readable: raw.readable,
    merchant: raw.merchant?.trim().slice(0, 200) || null,
    // Zero and negative are refused by the form and by the database. A receipt for nothing is a
    // misread total, and passing it through would fill the field with something unsaveable.
    amountCents: amountCents !== null && amountCents > 0 ? amountCents : null,
    taxCents,
    spentOn: resolveSpentOn(raw.spentOn, today),
    datePrinted: raw.datePrinted?.trim().slice(0, 60) || null,
    // An ISO code or nothing. Truncating "canadian dollars" to "CAN" would be a currency that does
    // not exist, arrived at by string slicing — the sort of value that looks deliberate downstream.
    currency: currencyOf(raw.currency),
    // The schema already constrains this to the eighteen. Checked again because the constraint lives
    // in a string the API enforces, and a category the database will refuse is a save that fails
    // after the person has finished checking everything.
    category: raw.category && CATEGORY_KEYS.includes(raw.category) ? raw.category : null,
  }
}

/**
 * Read one receipt.
 *
 * `tenantId` is here only so the spend lands on the right meter — this reads nothing from the
 * database. The caller has already resolved and authorised it.
 */
export async function readReceipt(tenantId: string, bytes: Buffer, mimeType: string, today: string): Promise<{
  reading: ReceiptReading
  model: string
  inputTokens: number
  outputTokens: number
  completionId: string
}> {
  const r = await readDocument<RawReceipt>({
    tenantId,
    bytes,
    mimeType,
    schema: RECEIPT_SCHEMA,
    prompt: PROMPT,
    model: RECEIPT_MODEL,
    effort: RECEIPT_EFFORT,
    // Eight short fields. The invoice reader's 16000 is sized for a hundred and thirty line items;
    // this much is already generous, and a smaller ceiling is one less way for a runaway answer to
    // keep somebody waiting.
    maxTokens: 2000,
    subject: 'receipt',
  })

  return {
    reading: shapeReading(r.value, today),
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    completionId: r.completionId,
  }
}
