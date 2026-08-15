import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import type { RudiSegment } from './rudi-line'

// THE DETAIL PAGE — one record, in the same design as ListPage.
//
// A detail screen is not a list, but it is not arbitrary either: every one of them is a title with an
// identifier, some state worn as chips, a set of actions, and then blocks that are either label/value
// facts or rows. That is the whole vocabulary, and it covers an order, a contact and — as far as its
// header goes — a conversation.
//
// It is a SERVER component. Nothing here is interactive: v2 detail screens are read-only, so there is
// no state to hold and no reason to ship this to the browser. `extra` takes a rendered node for the
// one thing a fact or a row cannot express — see the thread on the conversation screen.
//
// Same rule as ListPage: if a screen needs a branch in here, the shape is wrong and the answer is a
// new field, not an `if`.

export interface DetailAction {
  label: string
  tone?: 'primary' | 'quiet'
  /** Present = rendered disabled with this as the title. Most v2 actions still are. */
  disabledReason?: string
  /**
   * A client component rendered INSTEAD of the plain button.
   *
   * A FIELD, not a branch — the rule at the top of this file. This page is a server component, so it
   * cannot take an onClick; an action that actually does something has to arrive already built. The
   * caller styles its own control with .v2-ract so the row still reads as one set.
   */
  node?: ReactNode
}

export interface DetailChip {
  label: string
  tone?: 'accent' | 'quiet'
  /** A channel key, so the record wears the same hue as the row it came from. One mapping, everywhere. */
  channel?: string | null
}

export interface DetailFact {
  label: string
  /** Null renders an em dash: a fact that is absent is different from one that is empty. */
  value: string | null
}

export interface DetailRow {
  id: string
  primary: string
  detail?: string | null
  trailing?: string | null
}

export interface DetailSection {
  title: string
  facts?: DetailFact[]
  rows?: DetailRow[]
  /** Shown in place of facts/rows when the section has neither. */
  empty?: string
  /** Rendered after facts and rows. The escape hatch for a block with its own shape. */
  extra?: ReactNode
}

export interface DetailPageProps {
  /** Small mono line above the title — an order number, a phone number. */
  eyebrow?: string | null
  title: string
  chips?: DetailChip[]
  line: RudiSegment[]
  actions?: DetailAction[]
  sections: DetailSection[]
  backHref: string
  backLabel: string
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
)

export function DetailPage({ eyebrow, title, chips, line, actions, sections, backHref, backLabel }: DetailPageProps) {
  return (
    <div className="v2-page">
      <header className="v2-phd">
        <Link href={backHref} className="v2-bk" aria-label={backLabel}><Chevron /></Link>
        <h2>{title}</h2>
      </header>

      <div className="v2-pbody" data-scroll>
        {eyebrow && <p className="v2-eyebrow">{eyebrow}</p>}

        {chips && chips.length > 0 && (
          <div className="v2-chips" data-static>
            {chips.map((c) => (
              <span key={c.label} className="v2-chip" data-tone={c.tone ?? 'quiet'} data-channel={c.channel ?? undefined}>{c.label}</span>
            ))}
          </div>
        )}

        <p className="v2-lin">
          {line.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
        </p>

        {actions && actions.length > 0 && (
          <div className="v2-dacts">
            {actions.map((a) => (
              a.node
                ? <Fragment key={a.label}>{a.node}</Fragment>
                : (
                  <button
                    key={a.label}
                    type="button"
                    className="v2-ract"
                    data-tone={a.tone ?? 'quiet'}
                    disabled={!!a.disabledReason}
                    title={a.disabledReason}
                  >
                    {a.label}
                  </button>
                )
            ))}
          </div>
        )}

        {/* A section with no facts, no rows, no extra and no empty line of its own renders NOTHING.
            A heading over a void is worse than an absent heading: it says a thing exists and then
            fails to show it, which reads as a broken screen rather than an empty one. */}
        {sections.filter((s) => s.facts?.length || s.rows?.length || s.extra || s.empty).map((s) => (
          <section key={s.title} className="v2-dsec">
            <h3>{s.title}</h3>

            {s.facts && s.facts.length > 0 && (
              <dl className="v2-facts">
                {s.facts.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    {/* An absent fact is an em dash, not a blank — a blank reads as a rendering bug. */}
                    <dd>{f.value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            )}

            {s.rows?.map((r) => (
              <div key={r.id} className="v2-row">
                <div className="v2-m">
                  <p>{r.primary}</p>
                  {r.detail && <span>{r.detail}</span>}
                </div>
                {r.trailing && <em>{r.trailing}</em>}
              </div>
            ))}

            {s.extra}

            {!s.facts?.length && !s.rows?.length && !s.extra && (
              <p className="v2-pnone">{s.empty ?? 'Nothing here.'}</p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
