'use client'

import type { ReactNode } from 'react'

// THE SHARED CONTROLS.
//
// Built here rather than inlined on the agent screen, because that screen has fourteen sections and a
// toggle invented inside one of them becomes a dialect by the third. Everything below matches the
// language already in v2 — the accent for a thing that is ON or needs a person, the pale green for
// transient state, the same press treatment every row has, 44px targets.
//
// PRESENTATION ONLY. Each one takes a value and a callback and renders. None holds state, fetches
// anything, or decides what a change means; the screen that owns the data still owns it, which is what
// keeps "zero logic changes" true when these replace the existing inputs.
//
// `disabled` is the dependency state: a control whose connection is missing stays VISIBLE and inert.
// Never hidden — otherwise the owner never learns the capability exists.

export function StatusPill({ state, children }: { state: 'live' | 'pending' | 'off'; children: ReactNode }) {
  return <b className="v2-pill" data-state={state}>{children}</b>
}

export function GlassToggle({
  checked, onChange, label, hint, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="v2-ctlrow" data-disabled={disabled || undefined}>
      <span className="v2-ctltext">
        <span className="v2-ctllab">{label}</span>
        {hint && <em>{hint}</em>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-touch
        className="v2-toggle"
        data-on={checked || undefined}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </label>
  )
}

export function GlassInput({
  value, onChange, label, placeholder, hint, disabled, type = 'text', multiline,
}: {
  value: string; onChange: (v: string) => void; label: string
  placeholder?: string; hint?: string; disabled?: boolean; type?: string; multiline?: boolean
}) {
  return (
    <label className="v2-field" data-disabled={disabled || undefined}>
      <span className="v2-flab">{label}</span>
      {multiline ? (
        <textarea className="v2-finput" rows={4} value={value} placeholder={placeholder} disabled={disabled}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="v2-finput" type={type} value={value} placeholder={placeholder} disabled={disabled}
          onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <em className="v2-fhint">{hint}</em>}
    </label>
  )
}

export function GlassSelect({
  value, onChange, label, options, hint, disabled,
}: {
  value: string; onChange: (v: string) => void; label: string
  options: Array<{ value: string; label: string }>; hint?: string; disabled?: boolean
}) {
  return (
    <label className="v2-field" data-disabled={disabled || undefined}>
      <span className="v2-flab">{label}</span>
      <select className="v2-finput" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <em className="v2-fhint">{hint}</em>}
    </label>
  )
}

/** A set of mutually exclusive choices — the email reply mode's three options, and anything like it. */
export function GlassChoice({
  value, onChange, label, options, disabled,
}: {
  value: string; onChange: (v: string) => void; label: string
  options: Array<{ value: string; label: string; hint?: string }>; disabled?: boolean
}) {
  return (
    <div className="v2-field" data-disabled={disabled || undefined}>
      <span className="v2-flab">{label}</span>
      <div className="v2-choice">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-touch
            className="v2-choiceopt"
            data-on={value === o.value || undefined}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            <span>{o.label}</span>
            {o.hint && <em>{o.hint}</em>}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The dependency state, as a component so no screen writes its own version: the card stays visible,
 * its controls inert, and it says which connection is missing and where to go.
 */
export function NeedsConnection({ what }: { what: string }) {
  return (
    <p className="v2-needsconn">
      {what} is not connected yet, so this cannot be changed.{' '}
      <a href="/v2/settings/connections">Open Connections</a>
    </p>
  )
}
