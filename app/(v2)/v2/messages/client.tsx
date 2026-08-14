'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePressState } from '../use-press'
import { channelKey } from '../channels'
import { ChannelGlyph } from './glyphs'
import type { MilesInbox, WaitingRow } from '@/lib/miles/inbox-read'
import { heldSince } from '@/lib/miles/autonomy'

// THREE GROUPS, THREE STATES — waiting on you, needs you, handled.
//
// Not the shared ListPage, and the reason is in ListPage's own comment: a caller that needs a branch
// inside it means the shape is wrong. This screen needs three headed sections rather than one
// filtered list, and a row that EXPANDS in place into an editable draft with three actions. Those are
// two fields ListPage would have to grow for one caller, which is the fault it exists to prevent.
//
// What it does share: the tokens, the press state, and channelKey for every hue. There is no second
// channel colour table.

interface Props {
  data: MilesInbox
}

type Busy = { id: string; what: 'send' | 'mine' } | null

export function MessagesClient({ data }: Props) {
  usePressState()
  const router = useRouter()
  const { waiting, needs, handled, agentName } = data

  const [open, setOpen] = useState<string | null>(waiting[0]?.draftId ?? null)
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [failed, setFailed] = useState<Record<string, string>>({})

  async function decide(row: WaitingRow, what: 'send' | 'mine') {
    setBusy({ id: row.draftId, what })
    setFailed((f) => ({ ...f, [row.draftId]: '' }))
    try {
      const res = await fetch(`/api/miles/drafts/${row.draftId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: what === 'send' ? 'send' : 'handle',
          body: what === 'send' && editing === row.draftId ? text : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The draft stays where it is and says why. A failed send that silently disappears is the
        // worst outcome available: the owner believes the customer was answered.
        setFailed((f) => ({ ...f, [row.draftId]: json.error || 'That did not send.' }))
        return
      }
      setEditing(null)
      router.refresh()
    } catch {
      setFailed((f) => ({ ...f, [row.draftId]: 'That did not send — check your connection.' }))
    } finally {
      setBusy(null)
    }
  }

  const nothing = waiting.length === 0 && needs.length === 0 && handled.length === 0

  return (
    <div className="v2-page" data-miles>
      <header className="v2-phd">
        <button type="button" onClick={() => router.push('/v2')} className="v2-bk" aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <h2>Messages</h2>
      </header>

      <div className="v2-pbody" data-scroll>
        {nothing ? (
          <div className="v2-pempty">
            <p className="v2-pempty-t">Nothing is waiting on you.</p>
            <p className="v2-pempty-b">
              Instagram, Messenger, SMS and email land here. {agentName} answers what he can and holds
              anything that commits you to something.
            </p>
          </div>
        ) : (
          <>
            {/* The one true line, built from this screen's own numbers. Nothing is invented: a figure
                that is zero is left out of the sentence rather than written as "0". */}
            <p className="v2-lin">
              {waiting.length > 0 && <b>{waiting.length} {waiting.length === 1 ? 'draft is' : 'drafts are'} waiting on you</b>}
              {waiting.length > 0 && (needs.length > 0 || handled.length > 0) ? <span>. </span> : <span>.</span>}
              {needs.length > 0 && <span>{needs.length} {needs.length === 1 ? 'needs' : 'need'} you outright. </span>}
              {handled.length > 0 && <span>{agentName} handled {handled.length} on his own.</span>}
            </p>

            {waiting.length > 0 && (
              <>
                <p className="v2-mgl">
                  <i style={{ background: 'var(--v2-hold)' }} />
                  <b>WAITING ON YOU</b>
                  <em style={{ background: 'var(--v2-hold-wash)', color: 'var(--v2-hold-ink)' }}>{waiting.length}</em>
                  <u style={{ background: 'linear-gradient(90deg, rgba(245,165,36,.4), transparent)' }} />
                </p>
                <div className="v2-mcard">
                  {waiting.map((row, i) => {
                    const isOpen = open === row.draftId
                    const isEditing = editing === row.draftId
                    const working = busy?.id === row.draftId
                    return (
                      <div key={row.draftId}>
                        {i > 0 && <div className="v2-msep" />}
                        <button
                          type="button"
                          className="v2-mrow"
                          data-open={isOpen || undefined}
                          data-alarm={!row.announced && row.announceError ? true : undefined}
                          data-touch
                          onClick={() => setOpen(isOpen ? null : row.draftId)}
                          aria-expanded={isOpen}
                        >
                          <ChannelGlyph channel={channelKey(row.channel)} />
                          <span className="v2-mmid">
                            <p>{row.who}</p>
                            {/* THE CLASSIFIER'S OWN WORDS, with the text that triggered them quoted.
                                "Draft ready" would get approved without being read. */}
                            <span data-quote>{row.trigger}</span>
                          </span>
                          <span className="v2-mmeta">
                            <time>{heldSince(row.heldSince)}</time>
                            {/* An unannounced draft is not a draft with a note attached — it is a
                                different situation, and the row says so where the state goes. */}
                            <span className="v2-mtag" data-tone={row.announced || !row.announceError ? 'hold' : 'alarm'}>
                              {row.announced || !row.announceError ? 'DRAFT' : 'NOT SENT TO YOU'}
                            </span>
                          </span>
                        </button>

                        {isOpen && (
                          <div className="v2-mdraft">
                            {row.question && <p className="v2-mheld" style={{ marginTop: 0, marginBottom: 9 }}>{row.question}</p>}

                            {isEditing ? (
                              <textarea
                                className="v2-mbox"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                aria-label="Edit the draft"
                                autoFocus
                              />
                            ) : (
                              <div className="v2-mbox">{row.body}</div>
                            )}

                            <div className="v2-macts">
                              <button
                                type="button"
                                data-act="send"
                                disabled={working}
                                onClick={() => decide(row, 'send')}
                              >
                                {working && busy?.what === 'send' ? 'Sending…' : isEditing ? 'Send edit' : 'Send'}
                              </button>
                              <button
                                type="button"
                                data-act="edit"
                                disabled={working}
                                onClick={() => { setEditing(isEditing ? null : row.draftId); setText(row.body) }}
                              >
                                {isEditing ? 'Cancel' : 'Edit'}
                              </button>
                              <button
                                type="button"
                                data-act="mine"
                                disabled={working}
                                onClick={() => decide(row, 'mine')}
                              >
                                {working && busy?.what === 'mine' ? 'Handing over…' : "I'll handle it"}
                              </button>
                            </div>

                            {/* Held, but the owner was never reached. Said in the same place the
                                held line goes, because it changes what the owner should do next. */}
                            {!row.announced && row.announceError && (
                              <p className="v2-mheld" data-error>
                                <strong>This never reached you.</strong> The text and the email both failed
                                ({row.announceError}), so it has been sitting here unanswered since it was
                                held — and the customer is still waiting.
                              </p>
                            )}
                            {failed[row.draftId] ? (
                              <p className="v2-mheld" data-error>{failed[row.draftId]} It is still waiting for you.</p>
                            ) : (
                              <p className="v2-mheld">
                                Held {heldSince(row.heldSince)}. Nothing goes out until you decide.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {needs.length > 0 && (
              <>
                <p className="v2-mgl">
                  <i style={{ background: 'var(--v2-pink)' }} />
                  <b>NEEDS YOU</b>
                  <em style={{ background: 'var(--v2-pink)', color: '#fff' }}>{needs.length}</em>
                  <u style={{ background: 'linear-gradient(90deg, rgba(255,46,147,.35), transparent)' }} />
                </p>
                <div className="v2-mcard">
                  {needs.map((row, i) => (
                    <div key={row.conversationId}>
                      {i > 0 && <div className="v2-msep" />}
                      <button type="button" className="v2-mrow" data-touch onClick={() => router.push(`/v2/inbox/${row.conversationId}`)}>
                        <ChannelGlyph channel={channelKey(row.channel)} />
                        <span className="v2-mmid">
                          <p>{row.who}</p>
                          <span data-quote>{row.said}</span>
                        </span>
                        <span className="v2-mmeta">
                          <time>{heldSince(row.at)}</time>
                          <span className="v2-mnew">new</span>
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {handled.length > 0 && (
              <>
                <p className="v2-mgl">
                  <i style={{ background: 'var(--v2-miles)' }} />
                  <b>{agentName.toUpperCase()} HANDLED</b>
                  <em style={{ background: 'var(--v2-miles-wash)', color: 'var(--v2-miles-ink)' }}>{handled.length}</em>
                  <u style={{ background: 'linear-gradient(90deg, rgba(217,242,36,.5), transparent)' }} />
                </p>
                <div className="v2-mcard">
                  {handled.map((row, i) => (
                    <div key={row.conversationId}>
                      {i > 0 && <div className="v2-msep" />}
                      <button type="button" className="v2-mrow" data-touch onClick={() => router.push(`/v2/inbox/${row.conversationId}`)}>
                        <ChannelGlyph channel={channelKey(row.channel)} />
                        <span className="v2-mmid">
                          <p>{row.who}</p>
                          {/* THE EXACT TEXT THAT WENT OUT. A row saying "handled" without the words
                              sent in the owner's name is what would destroy trust in this. */}
                          <span data-quote>{agentName}: “{row.sent}”</span>
                        </span>
                        <span className="v2-mmeta">
                          <time>{heldSince(row.at)}</time>
                          <span className="v2-mtag" data-tone="sent">SENT</span>
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
