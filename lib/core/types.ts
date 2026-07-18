// Scalix Core — shared customer-layer types (isomorphic, no server imports).

export interface Company {
  id: string; tenant_id: string; name: string
  domain: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null
  archived_at: string | null; created_by: string | null; created_at: string; updated_at: string
}

export interface ContactCompany {
  id: string; tenant_id: string; contact_id: string; company_id: string
  role: string | null; is_primary: boolean; created_at: string
}

export type ActivityType = 'note' | 'call' | 'email' | 'sms' | 'appointment' | 'status_change' | 'merge' | 'archive' | 'system'

export interface Activity {
  id: string; tenant_id: string; contact_id: string | null; company_id: string | null
  subject_type: string | null; subject_id: string | null
  type: string; title: string | null; body: string | null
  actor_user_id: string | null; metadata: Record<string, unknown>
  occurred_at: string; created_at: string
}

export interface FileRecord {
  id: string; tenant_id: string; owner_type: string; owner_id: string
  bucket: string; path: string; filename: string | null; content_type: string | null; size_bytes: number | null
  visibility: 'private' | 'public'; uploaded_by: string | null; metadata: Record<string, unknown>; created_at: string
}

export type IdentityChannel = 'sms' | 'email' | 'whatsapp' | 'instagram' | 'facebook' | 'voice' | 'webchat'
export interface ChannelIdentity {
  id: string; tenant_id: string; contact_id: string; channel: IdentityChannel; external_id: string; created_at: string
}
