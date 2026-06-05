export type Plan = 'trial' | 'starter' | 'pro' | 'business'
export type ChannelType = 'sms' | 'whatsapp' | 'voice' | 'instagram' | 'facebook'
export type ConversationStatus = 'open' | 'resolved' | 'closed'
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
export type AIEmployeeStatus = 'active' | 'draft'
export type ChannelStatus = 'connected' | 'disconnected' | 'pending'
export type MessageRole = 'user' | 'assistant' | 'system'
export type Sentiment = 'positive' | 'neutral' | 'negative'
export type KnowledgeSource = 'manual' | 'website' | 'document' | 'template'

export type SkillType =
  | 'appointment_booking'
  | 'lead_qualification'
  | 'faq_answering'
  | 'review_request'
  | 'emergency_routing'
  | 'estimate_request'
  | 'appointment_reminders'
  | 'bilingual_autodetect'

export interface BusinessHours {
  mon: string
  tue: string
  wed: string
  thu: string
  fri: string
  sat: string
  sun: string
}

export interface Tenant {
  id: string
  user_id: string
  business_name: string
  industry: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  website: string | null
  business_hours: BusinessHours
  timezone: string
  forward_to_phone: string | null
  plan: Plan
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  trial_ends_at: string | null
  created_at: string
}

export interface AIEmployee {
  id: string
  tenant_id: string
  name: string
  avatar_url: string
  voice: string
  greeting: string
  personality: string
  personality_score: number
  system_prompt: string | null
  status: AIEmployeeStatus
  created_at: string
  channels?: Channel[]
  skills?: Skill[]
}

export interface Channel {
  id: string
  ai_employee_id: string
  tenant_id: string
  type: ChannelType
  credentials: Record<string, string>
  status: ChannelStatus
  twilio_number: string | null
  meta_page_id: string | null
  created_at: string
}

export interface Contact {
  id: string
  tenant_id: string
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
  channel: string | null
  language: string
  last_interaction: string | null
  total_conversations: number
  notes: string | null
  created_at: string
}

export interface Conversation {
  id: string
  tenant_id: string
  ai_employee_id: string | null
  contact_id: string | null
  channel: ChannelType
  status: ConversationStatus
  summary: string | null
  sentiment: Sentiment | null
  duration_seconds: number | null
  created_at: string
  updated_at: string
  contact?: Contact
  ai_employee?: AIEmployee
  messages?: Message[]
}

export interface Message {
  id: string
  conversation_id: string
  tenant_id: string
  role: MessageRole
  content: string
  channel: string | null
  timestamp: string
}

export interface Skill {
  id: string
  ai_employee_id: string
  tenant_id: string
  name: string
  type: SkillType
  config: Record<string, unknown>
  active: boolean
  created_at: string
}

export interface KnowledgeBase {
  id: string
  tenant_id: string
  ai_employee_id: string
  title: string
  content: string
  source: KnowledgeSource
  created_at: string
}

export interface Appointment {
  id: string
  tenant_id: string
  contact_id: string | null
  conversation_id: string | null
  service_type: string | null
  scheduled_at: string | null
  address: string | null
  notes: string | null
  status: AppointmentStatus
  reminder_sent: boolean
  created_at: string
  contact?: Contact
}

export interface AnalyticsEvent {
  id: string
  tenant_id: string
  event_type: string
  data: Record<string, unknown>
  created_at: string
}

export interface DashboardStats {
  totalCalls: number
  textMessages: number
  liveChats: number
  leadsGenerated: number
  totalConversations: number
  firstContactResolution: number
  avgHandleTime: number
}

// Wizard types
export interface WizardStep {
  id: number
  title: string
  completed: boolean
}

export interface WizardData {
  businessInfo: Partial<Tenant>
  employee: Partial<AIEmployee>
  knowledgeBase: Partial<KnowledgeBase>[]
  skills: SkillType[]
  channels: ChannelType[]
}
