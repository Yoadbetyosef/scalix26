import type { ContextSource } from '../types'
import { ACTIONS, isActionType } from '@/lib/assistant/registry'
import { precheckAction, createPendingAction } from '@/lib/assistant/execute'

// The ONE gateway the assistant uses to DO things. It never completes an action — it checks
// feasibility (module + integration + permission) and drafts it for the owner to confirm.
// The responder must relay the result verbatim and can NEVER claim completion from this alone.
export const actionSource: ContextSource = {
  id: 'request_action',
  description:
    "Use this WHENEVER the owner asks you to DO something external — send/reply email, reply on Instagram or Facebook, send an SMS or WhatsApp, create an estimate, send an invoice or payment link, create a task, update a lead, book an appointment, or update the catalog. It verifies the action is possible and DRAFTS it for the owner to confirm; it does NOT send anything. Relay its result exactly — never claim something was sent/created/updated unless a later confirmation says it was executed.",
  input_schema: {
    type: 'object',
    properties: {
      action_type: { type: 'string', enum: Object.keys(ACTIONS), description: 'the requested action' },
      target: { type: 'string', description: 'recipient — phone number for SMS, handle/id for social, email address (optional if unknown)' },
      body: { type: 'string', description: 'the exact message/content to send — your draft' },
    },
    required: ['action_type'],
  },
  run: async (ctx, args) => {
    const type = String(args.action_type || '')
    if (!isActionType(type)) return 'ACTION_UNSUPPORTED: I can’t do that action yet. I can help draft it, but I can’t send it until it’s connected.'
    const pre = await precheckAction(ctx.tenantId, type)
    if (!pre.ok) return `ACTION_BLOCKED: ${pre.reason} — tell the owner this exactly; do NOT claim it was done.`
    const { id } = await createPendingAction({ tenantId: ctx.tenantId, type, target: (args.target as string) || null, body: (args.body as string) || '' })
    return `ACTION_DRAFTED id=${id}: The ${ACTIONS[type].label.toLowerCase()} is DRAFTED and awaiting the owner's confirmation — it has NOT been sent. Show the owner the draft and ask them to confirm.`
  },
}
