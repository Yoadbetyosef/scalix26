'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CONTACT_FIELDS, parseContactsFile, reassignMapping, toImportRows, type ContactField, type ParsedFile } from '@/lib/contacts/csv'
import type { ImportPreview } from '@/lib/contacts/store'

// Bulk import in three steps: choose a file → confirm the columns → see exactly what will happen, then
// import. The file is read in the browser; only the mapped rows ever leave the page. Nothing is written
// until the last click, and anyone already in the book is skipped rather than duplicated.

type Step = 'choose' | 'map' | 'done'

export function ImportContacts({ trigger }: { trigger: ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<Array<ContactField | null>>([])
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [created, setCreated] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const reset = () => { setStep('choose'); setParsed(null); setMapping([]); setPreview(null); setFileName(''); setErr(null); setCreated(0) }
  const close = () => { setOpen(false); reset() }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setErr(null); setFileName(file.name)
    try {
      const text = await file.text()
      const p = parseContactsFile(text)
      if (!p.rows.length) throw new Error('That file has no rows we could read. Save it as CSV and try again.')
      setParsed(p); setMapping(p.mapping); setStep('map')
      await runPreview(p, p.mapping)
    } catch (e) {
      setErr((e as Error).message || 'Could not read that file.')
    }
  }

  // Ask the server to classify the rows without writing anything.
  const runPreview = async (p: ParsedFile, m: Array<ContactField | null>) => {
    setBusy(true)
    try {
      const rows = toImportRows(p.rows, m)
      const r = await fetch('/api/contacts/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'preview', rows }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail || j.error || 'Could not read that file')
      setPreview(j.preview)
    } catch (e) { setErr((e as Error).message); setPreview(null) } finally { setBusy(false) }
  }

  const changeMapping = (col: number, field: ContactField | null) => {
    if (!parsed) return
    // A field can only come from one column. The rule moved to lib/contacts/csv.ts unchanged, because
    // /v2 has an importer too and a copy in each would drift.
    const next = reassignMapping(mapping, col, field)
    setMapping(next)
    runPreview(parsed, next)
  }

  const commit = async () => {
    if (!parsed) return
    setBusy(true); setErr(null)
    try {
      const rows = toImportRows(parsed.rows, mapping)
      const r = await fetch('/api/contacts/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'commit', rows }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail || j.error || 'Import failed')
      setCreated(j.created); setStep('done'); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const mappedAny = mapping.some((m) => m !== null)

  return (
    <>
      <button onClick={() => setOpen(true)}>{trigger}</button>
      {!open ? null : (
        /* Same dialog shell as New contact — the card's edge on the same dimmed veil, at dialog
           width. Wider, because step two is a spreadsheet. */
        <div className="v2 fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" onClick={() => !busy && close()}>
          <div className="v2-veil" />
          <div
            className="relative my-12 w-full max-w-2xl"
            style={{ background: 'var(--v2-paper)', border: '1px solid var(--v2-line)', borderRadius: 16, padding: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* The header carries the step, so the dialog says where you are in the three of them. */}
            <div className="v2-head" style={{ marginBottom: 14 }}>
              <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
                <i />Import contacts{step === 'map' ? ' · check the columns' : step === 'done' ? ' · done' : ''}
              </p>
              <s />
            </div>

            {step === 'choose' && (
              <>
                <p className="v2-hint">Upload a CSV file. In Excel or Google Sheets choose <em>File → Download → CSV</em> first.</p>
                {/* The drop target keeps its dashed edge — that is what says "put something here" —
                    but it is the empty card's dashed edge rather than a second grey one. */}
                <button
                  onClick={() => fileInput.current?.click()}
                  className="v2-card mt-4 w-full"
                  style={{ alignItems: 'center', gap: 4, borderStyle: 'dashed', padding: '38px 16px', cursor: 'pointer' }}
                >
                  <b style={{ fontSize: 14.5, color: 'var(--v2-ink)' }}>Choose a file</b>
                  <span>CSV, TSV, or a tab-separated copy-paste from Excel</span>
                </button>
                <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <p className="v2-hint" style={{ marginTop: 12 }}>Columns named Name, Email, Phone, Address, Currency or Notes are matched automatically — anything else you can map by hand on the next step.</p>
                {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 14 }}><p>{err}</p></div>}
                <div className="mt-5"><button onClick={close} className="v2-act">Cancel</button></div>
              </>
            )}

            {step === 'map' && parsed && (
              <>
                <p className="v2-hint">{fileName} — {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}. Check each column is going to the right place.</p>

                {/* The kit's table. Its own scroll container, so a forty-column spreadsheet scrolls
                    inside the dialog rather than widening it. */}
                <div className="mt-4 max-h-64 overflow-auto" style={{ border: '1px solid var(--v2-line)', borderRadius: 12 }}>
                  <table className="v2-tbl" style={{ minWidth: '100%' }}>
                    <thead>
                      <tr>
                        {parsed.headers.map((h, i) => (
                          <th key={i} style={{ verticalAlign: 'top', padding: '10px 10px 8px' }}>
                            <div className="mb-1.5 truncate" title={h}>{h}</div>
                            <span className="v2-sel">
                              <select value={mapping[i] ?? ''} onChange={(e) => changeMapping(i, (e.target.value || null) as ContactField | null)}
                                      style={{ fontSize: 12, padding: '5px 22px 5px 0' }}>
                                <option value="">Don&apos;t import</option>
                                {CONTACT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                              </select>
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 5).map((r, ri) => (
                        <tr key={ri}>{r.map((c, ci) => (
                          <td key={ci} className="max-w-[10rem] truncate" title={c}
                              style={{ fontSize: 12.5, padding: '8px 10px', color: mapping[ci] ? 'var(--v2-ink)' : 'var(--v2-ink-45)' }}>
                            {c || '—'}
                          </td>
                        ))}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.rows.length > 5 && <p className="v2-hint" style={{ marginTop: 6 }}>Showing the first 5 rows.</p>}

                {/* Three outcomes, three chips in three hues — the same chip the rest of the app
                    uses for a state, rather than three coloured blocks. */}
                {preview && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    {([
                      ['will be added', preview.toCreate.length, 'var(--v2-t2)'],
                      ['already in your contacts', preview.duplicates.length, 'var(--v2-t4)'],
                      ['skipped', preview.skipped.length, 'var(--v2-ink-45)'],
                    ] as Array<[string, number, string]>).map(([label, n, hue]) => (
                      <div key={label} className="flex items-baseline gap-2">
                        <span className="sx-tabular" style={{ fontSize: 20, fontWeight: 300, color: 'var(--v2-ink)' }}>{n}</span>
                        <span className="v2-stat" style={{ ['--chan' as string]: hue }}>{label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {preview && preview.duplicates.length > 0 && (
                  <p className="v2-hint" style={{ marginTop: 10 }}>
                    Matched by email or phone against people already in your book — those rows are left alone, so nothing gets duplicated.
                  </p>
                )}
                {!mappedAny && (
                  <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 14 }}>
                    <p>Pick at least one column to import.</p>
                  </div>
                )}
                {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 14 }}><p>{err}</p></div>}

                <div className="mt-5 flex flex-wrap gap-2">
                  <button onClick={commit} disabled={busy || !mappedAny || !preview?.toCreate.length} className="v2-act" data-solid>
                    {busy ? 'Working…' : `Import ${preview?.toCreate.length ?? 0} contact${preview?.toCreate.length === 1 ? '' : 's'}`}
                  </button>
                  <button onClick={reset} disabled={busy} className="v2-act">Choose a different file</button>
                </div>
              </>
            )}

            {step === 'done' && (
              <>
                <p className="text-sm" style={{ color: 'var(--v2-ink)' }}>
                  Added <span className="font-semibold">{created}</span> contact{created === 1 ? '' : 's'} from {fileName}.
                </p>
                <div className="mt-5 flex gap-2">
                  <button onClick={close} className="v2-act" data-solid>Done</button>
                  <button onClick={reset} className="v2-act">Import another file</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
