'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Modal } from '@/components/v2/modal'

/**
 * THE SIX window.confirm() CALLS, GIVEN A DIALOG.
 *
 * Cancel an order, mark it finished, delete it, archive it to the catalogue, revoke an approval,
 * delete an attachment — every destructive act in /orders was a native confirm. Three problems with
 * that, in the order they matter:
 *
 *   IT LOOKS LIKE THE BROWSER, not like the product, at the exact moment somebody is deciding
 *   whether to destroy something. The one dialog a person should read carefully is the one that
 *   arrives in a chrome they have learned to dismiss.
 *
 *   IT CANNOT SAY WHAT IS AT STAKE. `confirm()` takes a string. "Permanently delete order
 *   ORD-1042? This removes the order, its files, and all approval links." is one grey paragraph;
 *   the same words in a dialog can put the order number where the eye goes and the consequences
 *   under it.
 *
 *   IT BLOCKS THE MAIN THREAD and is suppressible — a browser may refuse to show it at all after
 *   repeated dialogs, in which case `confirm()` silently returns false and the action just... does
 *   not happen.
 *
 * Promise-based so the call sites keep their shape: `if (!(await ask({...}))) return` is the same
 * line as `if (!confirm('…')) return`, which is the point — this is not a refactor of the logic,
 * it is the same guard behind a real dialog.
 */

export interface ConfirmRequest {
  title: string
  /** What actually happens. Say the irreversible part out loud. */
  body: ReactNode
  /** The verb on the button that does it. "Delete order", not "OK". */
  confirmLabel: string
  /** Red pill, for anything that cannot be undone. */
  danger?: boolean
}

export function useConfirm() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback((r: ConfirmRequest) => new Promise<boolean>((resolve) => {
    resolver.current = resolve
    setReq(r)
  }), [])

  const settle = useCallback((ok: boolean) => {
    setReq(null)
    resolver.current?.(ok)
    resolver.current = null
  }, [])

  const dialog = (
    <Modal
      open={!!req}
      onClose={() => settle(false)}
      title={req?.title ?? ''}
      actions={req ? (
        <>
          <button type="button" className="v2-act" data-solid={!req.danger || undefined} data-danger={req.danger || undefined}
                  onClick={() => settle(true)}>
            {req.confirmLabel}
          </button>
          <button type="button" className="v2-act" onClick={() => settle(false)}>Keep it</button>
        </>
      ) : null}
    >
      <p className="text-sm" style={{ color: 'var(--v2-ink)', lineHeight: 1.5 }}>{req?.body}</p>
    </Modal>
  )

  return { ask, dialog }
}
