'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CONTACT_FIELDS, parseContactsFile, reassignMapping, toImportRows,
  type ContactField, type ParsedFile,
} from '@/lib/contacts/csv'
import type { ImportPreview } from '@/lib/contacts/store'
import {
  Sheet, ContactFields, emptyContact, duplicateMessage, type ContactValues,
} from './sheet'

// THE TWO CONTACTS ACTIONS, RESKINNED.
//
// A RESKIN, not new capability. Both already work in v1 and both call the same routes unchanged —
// POST /api/contacts and POST /api/contacts/import. Every rule that decides anything still lives
// where it lived: parsing and header-matching in lib/contacts/csv.ts, classification on the server in
// previewImport/commitImport. Nothing here decides who is a duplicate or what a column means.
//
// One thing did move, and it is worth naming rather than duplicating: "a field can only come from one
// column" was written inside the v1 component. It is `reassignMapping` in lib/contacts/csv.ts now,
// verbatim, and BOTH importers call it. A rule copied into two components is a rule that will drift.

const UploadGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
)

// ── NEW CONTACT ─────────────────────────────────────────────────────────────────────────────────

export function NewContact() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<ContactValues>(emptyContact)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  function close() { setOpen(false); setV(emptyContact()); setOutcome(null) }

  async function create() {
    if (busy) return
    setBusy(true)
    setOutcome(null)
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()]))),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The SAME contract edit answers with: 409 carrying the record it clashed with, so the
        // sentence names them instead of saying "duplicate" and leaving the owner to guess.
        setOutcome(duplicateMessage(j, 'That did not save.'))
        return
      }
      close()
      router.refresh()
    } catch {
      setOutcome('That did not save — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-hact" data-tone="primary" data-touch onClick={() => setOpen(true)}>New contact</button>

      {open && (
        <Sheet title="New contact" busy={busy} onClose={close}>
          <ContactFields values={v} onChange={setV} disabled={busy} />
          {outcome && (
            <p className="v2-emsg" data-bad>
              {outcome}
              {/* The record it clashed with is a real place to go, not a fact to be told. */}
              {outcome.includes('belongs to') && <> <a href="/v2/contacts">Find them in contacts.</a></>}
            </p>
          )}
          <p className="v2-ehint">A name, an email or a phone number is enough to start.</p>
          <div className="v2-eacts">
            <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="v2-epri" onClick={() => void create()} disabled={busy}>
              {busy ? 'Adding…' : 'Add contact'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}

// ── IMPORT FILE ─────────────────────────────────────────────────────────────────────────────────
//
// Three steps, exactly as v1: choose a file → confirm the columns → see what will happen, then
// import. The file is read in the browser and only mapped rows ever leave the page; nothing is
// written until the last click.
//
// The preview shows all THREE outcomes — created, already in the book, unusable — because that is
// the entire point of running two passes. A preview that only counts what it will add is a progress
// bar, not a preview.

type Step = 'choose' | 'map' | 'done'

export function ImportContacts() {
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

  /** Ask the server to classify the rows without writing anything. */
  const runPreview = async (p: ParsedFile, m: Array<ContactField | null>) => {
    setBusy(true)
    try {
      const rows = toImportRows(p.rows, m)
      const r = await fetch('/api/contacts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', rows }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail || j.error || 'Could not read that file')
      setPreview(j.preview)
      setErr(null)
    } catch (e) { setErr((e as Error).message); setPreview(null) } finally { setBusy(false) }
  }

  const changeMapping = (col: number, field: ContactField | null) => {
    if (!parsed) return
    const next = reassignMapping(mapping, col, field)
    setMapping(next)
    void runPreview(parsed, next)
  }

  const commit = async () => {
    if (!parsed) return
    setBusy(true); setErr(null)
    try {
      const rows = toImportRows(parsed.rows, mapping)
      const r = await fetch('/api/contacts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', rows }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail || j.error || 'Import failed')
      setCreated(j.created); setStep('done'); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const mappedAny = mapping.some((m) => m !== null)

  return (
    <>
      <button type="button" className="v2-hact" data-tone="quiet" data-touch onClick={() => setOpen(true)}>
        <UploadGlyph />Import file
      </button>

      {open && (
        <Sheet title="Import contacts" wide busy={busy} onClose={close}>
          {step === 'choose' && (
            <>
              <p className="v2-ehint" data-lead>Upload a CSV. In Excel or Google Sheets choose <em>File → Download → CSV</em> first.</p>
              <button type="button" className="v2-idrop" onClick={() => fileInput.current?.click()}>
                <b>Choose a file</b>
                <span>CSV, TSV, or a tab-separated copy-paste from Excel</span>
              </button>
              <input
                ref={fileInput} type="file" className="v2-ifile"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <p className="v2-ehint">Columns named Name, Email, Phone, Address, Currency or Notes are matched automatically — anything else you can map by hand on the next step.</p>
              {err && <p className="v2-emsg" data-bad>{err}</p>}
              <div className="v2-eacts">
                <button type="button" className="v2-esec" onClick={close}>Cancel</button>
              </div>
            </>
          )}

          {step === 'map' && parsed && (
            <>
              <p className="v2-ehint" data-lead>{fileName} — {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}. Check each column is going to the right place.</p>

              <div className="v2-igrid">
                <table>
                  <thead>
                    <tr>
                      {parsed.headers.map((h, i) => (
                        <th key={i}>
                          <span title={h}>{h}</span>
                          <select value={mapping[i] ?? ''} onChange={(e) => changeMapping(i, (e.target.value || null) as ContactField | null)}>
                            <option value="">Don&apos;t import</option>
                            {CONTACT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((r, ri) => (
                      <tr key={ri}>
                        {r.map((c, ci) => (
                          // A column that is not being imported is greyed rather than hidden: seeing
                          // what you are LEAVING BEHIND is half of checking the mapping.
                          <td key={ci} data-off={mapping[ci] ? undefined : true} title={c}>{c || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > 5 && <p className="v2-ehint">Showing the first 5 rows.</p>}

              {/* ALL THREE OUTCOMES. A preview that counts only what it will add is a progress bar. */}
              {preview && (
                <div className="v2-icounts">
                  <div data-tone="add"><b>{preview.toCreate.length}</b><span>will be added</span></div>
                  <div data-tone="dupe"><b>{preview.duplicates.length}</b><span>already in your contacts</span></div>
                  <div data-tone="skip"><b>{preview.skipped.length}</b><span>can&apos;t be used</span></div>
                </div>
              )}
              {preview && preview.duplicates.length > 0 && (
                <p className="v2-ehint">Matched by email or phone against people already in your book — those rows are left alone, so nothing gets duplicated.</p>
              )}
              {preview && preview.skipped.length > 0 && (
                <p className="v2-ehint">{preview.skipped[0].reason}{preview.skipped.length > 1 ? `, and ${preview.skipped.length - 1} more like it.` : '.'}</p>
              )}
              {!mappedAny && <p className="v2-emsg" data-bad>Pick at least one column to import.</p>}
              {err && <p className="v2-emsg" data-bad>{err}</p>}

              <div className="v2-eacts">
                <button type="button" className="v2-esec" onClick={reset} disabled={busy}>Choose a different file</button>
                <button type="button" className="v2-epri" onClick={() => void commit()} disabled={busy || !mappedAny || !preview?.toCreate.length}>
                  {busy ? 'Working…' : `Import ${preview?.toCreate.length ?? 0} contact${preview?.toCreate.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <p className="v2-idone">Added <b>{created}</b> contact{created === 1 ? '' : 's'} from {fileName}.</p>
              <div className="v2-eacts">
                <button type="button" className="v2-esec" onClick={reset}>Import another file</button>
                <button type="button" className="v2-epri" onClick={close}>Done</button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
