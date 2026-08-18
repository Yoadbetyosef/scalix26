'use client'

import { useEffect, useRef, useState } from 'react'
import { RECEIPT_ACCEPT_ATTR } from '@/lib/expenses/receipt'
import { ExpenseSheet, Plus } from './sheet'

// ADDING AN EXPENSE — and the tap that opens the camera.
//
// Two placements, one component — the header and the empty state — for the reason the bills upload
// has two: the empty state is the moment somebody most wants the action, and a screen that says "add
// one" beside no control is making a promise it cannot keep.
//
// ── ONE TAP, NOT TWO ────────────────────────────────────────────────────────────────────────────
//
// Add opens the camera. Typing an amount, a merchant and a category off a receipt you are already
// holding is the WORK — skipping it is the entire point — so the photograph cannot be the optional
// last step of a form somebody has already filled in. It has to be the first thing that happens.
//
// The file input lives HERE rather than inside the sheet, and that is load-bearing: a file picker
// only opens inside the user gesture that asked for it, and the sheet is not mounted yet at the
// moment of the tap. So the tap does both — opens the sheet and clicks this input — inside one call
// stack, and the chosen photograph is handed to the sheet when it arrives.
//
// ── AND CANCELLING IS A FIRST-CLASS PATH ────────────────────────────────────────────────────────
//
// Somebody with no receipt, or with the amount in their head, dismisses the camera and gets the form
// they have always had. The `cancel` event is what says so — and it is also what puts today back in
// the date field, because with no photograph coming, today is a reasonable guess again rather than a
// claim about a receipt nobody read. A browser too old to fire `cancel` leaves the date blank, which
// is one extra tap and never a wrong date.

export function AddExpense({ showsTax, tone = 'header' }: { showsTax: boolean; tone?: 'header' | 'empty' }) {
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [expectPhoto, setExpectPhoto] = useState(true)

  // `cancel` fires when the picker closes with nothing chosen. React has no onCancel prop for it, so
  // it is wired directly.
  useEffect(() => {
    const el = input.current
    if (!el) return
    const onCancel = () => setExpectPhoto(false)
    el.addEventListener('cancel', onCancel)
    return () => el.removeEventListener('cancel', onCancel)
  }, [])

  function start() {
    setFile(null)
    setExpectPhoto(true)
    setOpen(true)
    if (input.current) input.current.value = ''
    input.current?.click()
  }

  function close() {
    setOpen(false)
    setFile(null)
    if (input.current) input.current.value = ''
  }

  return (
    <>
      <button type="button" className="v2-hact" data-tone="primary" data-touch onClick={start}>
        <Plus />{tone === 'header' ? 'Add' : 'Add an expense'}
      </button>

      {/* capture="environment" asks for the rear camera directly on a phone, and is ignored on a
          desktop, where the same control is an ordinary file picker. It also means this control does
          NOT offer the photo library — the receipt somebody snapped an hour ago is reached by
          dismissing the camera and using "Attach a receipt" in the sheet, which has no capture and so
          opens the full picker. One extra tap for the rarer case, none for the common one. */}
      <input
        ref={input}
        type="file"
        accept={RECEIPT_ACCEPT_ATTR}
        capture="environment"
        className="v2-hidden-file"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (!f) setExpectPhoto(false) }}
      />

      {open && (
        <ExpenseSheet
          showsTax={showsTax}
          initialFile={file}
          expectPhoto={expectPhoto}
          onClose={close}
        />
      )}
    </>
  )
}
