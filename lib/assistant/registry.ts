import type { ModuleKey } from '@/lib/modules'
import type { Permission } from './permissions'
import type { IntegrationKey } from './integrations'

export type ActionType =
  | 'send_email' | 'reply_email' | 'reply_instagram' | 'reply_facebook'
  | 'send_sms' | 'send_whatsapp' | 'create_estimate' | 'send_invoice'
  | 'send_payment_link' | 'create_task' | 'update_lead' | 'book_appointment' | 'update_catalog'

export interface ActionDef {
  label: string
  channel: string
  module?: ModuleKey          // module that must be enabled (if any)
  integration?: IntegrationKey // integration that must be connected (if any)
  permission: Permission
  supported: boolean          // is there a REAL executor? false → "can't do that yet, can draft"
  risky: boolean              // requires explicit user confirmation before executing
}

export const ACTIONS: Record<ActionType, ActionDef> = {
  send_email: { label: 'Send email', channel: 'email', integration: 'email', permission: 'can_send_email', supported: false, risky: true },
  reply_email: { label: 'Reply to email', channel: 'email', integration: 'email', permission: 'can_send_email', supported: false, risky: true },
  reply_instagram: { label: 'Reply on Instagram', channel: 'instagram', integration: 'instagram', permission: 'can_reply_social', supported: false, risky: true },
  reply_facebook: { label: 'Reply on Facebook', channel: 'facebook', integration: 'facebook', permission: 'can_reply_social', supported: false, risky: true },
  send_sms: { label: 'Send SMS', channel: 'sms', integration: 'twilio', permission: 'can_send_sms', supported: true, risky: true },
  send_whatsapp: { label: 'Send WhatsApp', channel: 'whatsapp', integration: 'twilio', permission: 'can_send_whatsapp', supported: false, risky: true },
  create_estimate: { label: 'Create estimate', channel: 'estimate', module: 'estimates', permission: 'can_create_estimates', supported: false, risky: true },
  send_invoice: { label: 'Send invoice', channel: 'invoice', module: 'invoices', permission: 'can_send_invoices', supported: false, risky: true },
  send_payment_link: { label: 'Send payment link', channel: 'stripe', integration: 'stripe', permission: 'can_send_payment_links', supported: false, risky: true },
  create_task: { label: 'Create task', channel: 'task', permission: 'can_create_tasks', supported: false, risky: false },
  update_lead: { label: 'Update lead', channel: 'lead', module: 'pipeline', permission: 'can_update_leads', supported: false, risky: false },
  book_appointment: { label: 'Book appointment', channel: 'appointment', module: 'scheduling', permission: 'can_book_appointments', supported: false, risky: true },
  update_catalog: { label: 'Update catalog', channel: 'catalog', module: 'inventory', permission: 'can_edit_catalog', supported: false, risky: false },
}

export const isActionType = (v: unknown): v is ActionType => typeof v === 'string' && v in ACTIONS
