import { createAdminClient } from '@/lib/supabase/server'
import type { Appointment } from '@/components/dashboard/appointments-table'
import type { Lead } from '@/types'

// The dashboard's own data load, moved here VERBATIM from app/dashboard/page.tsx.
//
// ── WHY IT MOVED ────────────────────────────────────────────────────────────────────────────────────
//
// It was a module-private function in the dashboard PAGE, and /v2 reached it by exporting it and
// importing across route modules. That worked at runtime and cost 319 KB of JavaScript: importing
// anything from app/dashboard/page drags that module's whole graph, and the graph reaches
// DashboardHero -> rudi-presence -> lib/supabase/client. So /v2 shipped LeadsTable,
// AppointmentsTable, ImpactDashboard, AttentionSync and the entire Supabase browser client, and
// rendered not one of them.
//
// Living in lib/ it has no client components in its graph at all. The only component reference left
// is `Appointment`, imported as a TYPE and erased at compile time, so it creates no runtime edge.
//
// ── THE BODY BELOW IS UNCHANGED ─────────────────────────────────────────────────────────────────────
//
// Same logic, same signature, same return shape, comments included. It was extracted programmatically
// rather than retyped — see lib/invoices/OUTSTANDING.md §7h: a restatement that drifts is more
// dangerous than a fragment, because a fragment advertises that it is incomplete.

export async function getDashboardData(tenantId: string) {
  // Admin (true service-role) client + explicit tenant_id on every query (verified) → works for the
  // owner tenant AND for a White Label partner operating a client workspace. NOTE: createServiceClient
  // is the cookie-based SSR client — in operator mode it downgrades to the partner's JWT and RLS scopes
  // to the partner's OWN tenant, silently returning zero rows for the client tenant. createAdminClient
  // never picks up the user session, so the server-validated tenantId filter is the sole (and correct) scope.
  const supabase = createAdminClient()

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: totalCalls },
    { count: totalSMS },
    { count: totalConversations },
    { count: leads },
    { count: activeLeads },
    { data: conversations },
    { data: aiEmployees },
    { data: leadRecords },
  ] = await Promise.all([
    // Total Calls — voice activity is logged as message_handled with
    // data.channel='voice' (no code ever emitted 'call_handled').
    supabase.from('analytics_events').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('event_type', 'message_handled').eq('data->>channel', 'voice').gte('created_at', sevenDaysAgo),
    // Text Messages — SMS only (message_handled also covers voice/social).
    supabase.from('analytics_events').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('event_type', 'message_handled').eq('data->>channel', 'sms').gte('created_at', sevenDaysAgo),
    // Live Chat — Instagram + Facebook conversations only.
    supabase.from('conversations').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).in('channel', ['instagram', 'facebook']).gte('created_at', sevenDaysAgo),
    // Leads Generated — total count, straight from the leads table (lead_captured
    // analytics events were never emitted, so the old count was stuck at 0).
    supabase.from('leads').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    // Active leads (need attention) — for the Leads tab badge. Excludes booked
    // and dismissed.
    supabase.from('leads').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).in('status', ['new', 'contacted']),
    supabase.from('conversations')
      .select('*, contact:contacts(name, phone)')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase.from('ai_employees')
      .select('*, channels(*), skills(*)')
      .eq('tenant_id', tenantId)
      // Oldest first. Every consumer that picks "the" employee from this array gets a stable answer,
      // rather than whatever order the database happened to return.
      .order('created_at', { ascending: true }),
    // Leads — resilient: if the table doesn't exist yet, data is null -> []
    supabase.from('leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const leadsList = (leadRecords as Lead[] | null) || []

  // The lead→destination map went with the Leads tab. It cost a real query — every conversation
  // belonging to any lead's contact, ordered, just to pick the newest one per contact so a table row
  // could be clickable. Nothing renders that table any more. This is the one genuinely dead query
  // the Leads removal found.

  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, customer_name, customer_phone, customer_email, channel, slot_date, slot_time, service_type, status, skip_review, review_sent_at')
    .eq('tenant_id', tenantId)
    .order('slot_date', { ascending: false })
    .order('slot_time', { ascending: true })
    .limit(100)

  return {
    stats: {
      totalCalls: totalCalls || 0,
      textMessages: totalSMS || 0,
      totalConversations: totalConversations || 0,
      leads: leads || 0,
      activeLeads: activeLeads || 0,
    },
    conversations: conversations || [],
    aiEmployees: aiEmployees || [],
    leads_list: leadsList,
    appointments_list: (appointments || []) as Appointment[],
  }
}
