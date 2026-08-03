'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CONTACT_FIELDS, parseContactsFile, toImportRows, type ContactField, type ParsedFile } from '@/lib/contacts/csv'
import type { ImportPreview } from '@/lib/contacts/store'

// Bulk import in three steps: choose a file → confirm the columns → see exactly what will happen, then
// import. The file is read in the browser; only the mapped rows ever leave the page. Nothing is written
// until the last click, and anyone already in the book is skipped rather than duplicated.

const inp = 'w-full rounded-lg border border-gray-300 px-2 py-1 text-xs'
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
    // A field can only come from one column — assigning it elsewhere clears the previous holder.
    const next = mapping.map((f, i) => (field && f === field && i !== col ? null : f))
    next[col] = field
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !busy && close()}>
          <div className="my-12 w-full max-w-2xl rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Import contacts</h3>

            {step === 'choose' && (
              <>
                <p className="mt-0.5 text-xs text-gray-500">Upload a CSV file. In Excel or Google Sheets choose <em>File → Download → CSV</em> first.</p>
                <button
                  onClick={() => fileInput.current?.click()}
                  className="mt-4 flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-gray-300 px-4 py-10 text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">Choose a file</span>
                  <span className="text-xs text-gray-500">CSV, TSV, or a tab-separated copy-paste from Excel</span>
                </button>
                <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <p className="mt-3 text-xs text-gray-500">Columns named Name, Email, Phone, Address, Currency or Notes are matched automatically — anything else you can map by hand on the next step.</p>
              </>
            )}

            {step === 'map' && parsed && (
              <>
                <p className="mt-0.5 text-xs text-gray-500">{fileName} — {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}. Check each column is going to the right place.</p>

                <div className="mt-4 max-h-64 overflow-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        {parsed.headers.map((h, i) => (
                          <th key={i} className="border-b border-gray-200 px-2 py-2 text-left align-top">
                            <div className="mb-1 truncate font-medium text-gray-700" title={h}>{h}</div>
                            <select value={mapping[i] ?? ''} onChange={(e) => changeMapping(i, (e.target.value || null) as ContactField | null)} className={inp}>
                              <option value="">Don&apos;t import</option>
                              {CONTACT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {parsed.rows.slice(0, 5).map((r, ri) => (
                        <tr key={ri}>{r.map((c, ci) => <td key={ci} className={`max-w-[10rem] truncate px-2 py-1.5 ${mapping[ci] ? 'text-gray-800' : 'text-gray-300'}`} title={c}>{c || '—'}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.rows.length > 5 && <p className="mt-1 text-xs text-gray-400">Showing the first 5 rows.</p>}

                {preview && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-emerald-50 px-3 py-2"><div className="text-lg font-semibold text-emerald-800">{preview.toCreate.length}</div><div className="text-xs text-emerald-700">will be added</div></div>
                    <div className="rounded-lg bg-amber-50 px-3 py-2"><div className="text-lg font-semibold text-amber-800">{preview.duplicates.length}</div><div className="text-xs text-amber-700">already in your contacts</div></div>
                    <div className="rounded-lg bg-gray-100 px-3 py-2"><div className="text-lg font-semibold text-gray-700">{preview.skipped.length}</div><div className="text-xs text-gray-600">skipped</div></div>
                  </div>
                )}
                {preview && preview.duplicates.length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    Matched by email or phone against people already in your book — those rows are left alone, so nothing gets duplicated.
                  </p>
                )}
                {!mappedAny && <p className="mt-3 text-xs text-amber-700">Pick at least one column to import.</p>}

                {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
                <div className="mt-4 flex gap-2">
                  <button onClick={commit} disabled={busy || !mappedAny || !preview?.toCreate.length} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">
                    {busy ? 'Working…' : `Import ${preview?.toCreate.length ?? 0} contact${preview?.toCreate.length === 1 ? '' : 's'}`}
                  </button>
                  <button onClick={reset} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Choose a different file</button>
                </div>
              </>
            )}

            {step === 'done' && (
              <>
                <p className="mt-4 text-sm text-gray-800">Added <span className="font-semibold">{created}</span> contact{created === 1 ? '' : 's'} from {fileName}.</p>
                <div className="mt-4 flex gap-2">
                  <button onClick={close} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">Done</button>
                  <button onClick={reset} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Import another file</button>
                </div>
              </>
            )}

            {step === 'choose' && err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
            {step === 'choose' && <div className="mt-4"><button onClick={close} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button></div>}
          </div>
        </div>
      )}
    </>
  )
}
