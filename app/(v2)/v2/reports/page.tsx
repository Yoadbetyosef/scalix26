import { REPORT_TEMPLATES } from '@/lib/reports/templates'
import { DetailPage, type DetailRow } from '../detail'
import { listPageContext, PREVIEW } from '../list-page'
import { reportsLine } from './line'

// Reports, reskinned. There is no loader to reuse — app/reports/page.tsx renders a constant and a
// client ReportBuilder — so the only thing shared is the template list itself, now in lib/reports.
// READ-ONLY: building and exporting are the real screen's job and both render disabled here.

export const dynamic = 'force-dynamic'

export default async function V2Reports() {
  await listPageContext('analytics')

  const rows: DetailRow[] = REPORT_TEMPLATES.map((t) => ({
    id: t.id,
    primary: t.name,
    detail: t.description,
  }))

  return (
    <DetailPage
      backHref="/v2"
      backLabel="Home"
      title="Reports"
      line={reportsLine({ templates: rows.length })}
      // The two things the real screen does. They are the same two for every template, so they sit
      // once at the top rather than repeating on all four rows.
      actions={[
        { label: 'Build a report', tone: 'primary', disabledReason: PREVIEW },
        { label: 'Export', disabledReason: PREVIEW },
      ]}
      sections={[{ title: 'Ready to run', rows }]}
    />
  )
}
