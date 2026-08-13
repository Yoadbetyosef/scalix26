// The report templates, moved here from app/reports/page.tsx so both screens list the same four.
//
// Reports has no data loader — the page renders this constant and a client ReportBuilder — so there
// was nothing to extract but the content itself. What did NOT come with it is `icon` and `tone`: a
// lucide component and a Tailwind background are v1's presentation, and v2 draws its own. The id,
// name and description are the report; the rest was the old screen's costume.
//
// Names and descriptions are byte-identical to the originals.

export interface ReportTemplate {
  id: string
  name: string
  description: string
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  { id: 'platform_usage', name: 'Platform Usage', description: 'Total conversations, messages, and active channels over time.' },
  { id: 'ai_productivity', name: 'AI Employee Productivity', description: 'Resolution rates, handle times, and skill usage per AI employee.' },
  { id: 'lead_generation', name: 'Lead Generation', description: 'Leads captured, qualified, and converted per channel.' },
  { id: 'appointment_report', name: 'Appointment Report', description: 'Booked, completed, and no-show appointments.' },
]
