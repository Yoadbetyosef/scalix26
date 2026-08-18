'use client'

import { useState } from 'react'
import { ExpenseSheet, Plus } from './sheet'

// ADDING AN EXPENSE — the button, and nothing else.
//
// Two placements, one component — the header and the empty state — for the reason the bills upload
// has two: the empty state is the moment somebody most wants the action, and a screen that says "add
// one" beside no control is making a promise it cannot keep.
//
// The form itself lives in sheet.tsx, shared with editing a row. See its header for why.

export function AddExpense({ showsTax, tone = 'header' }: { showsTax: boolean; tone?: 'header' | 'empty' }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="v2-hact" data-tone="primary" data-touch onClick={() => setOpen(true)}>
        <Plus />{tone === 'header' ? 'Add' : 'Add an expense'}
      </button>
      {open && <ExpenseSheet showsTax={showsTax} onClose={() => setOpen(false)} />}
    </>
  )
}
