# /v2 — open threads

Kept here rather than in `lib/invoices/OUTSTANDING.md`: that file lives on
`feat/landed-cost-invoices` and does not exist on this branch, so writing to that path would
conflict on merge. Fold these in when the branches meet.

## 1. The canvas does not start until the first interaction — cause unidentified

**Status:** worked around, not fixed. `rudi-canvas.tsx` starts the render loop on the first
`pointermove` / `pointerdown` / `keydown` / `scroll`, one listener removed the moment any of them
fires. Until then she is a still frame.

**Established, and not worth re-investigating:**

- **The canvas is correct.** A cold-load log showed the ResizeObserver firing at +1ms with a real
  `contentRect`, the mesh built at +244ms from 900 points, the first canvas draw at 3ms, and
  `visible` / `onScreen` / `running` all true. It draws correctly and then stops mattering.
- **Nothing in `/v2` subscribes to `resize`.** `useMagnet`, `usePalette` and `Cursor` use `matchMedia`
  for `pointer: fine` and `prefers-reduced-motion` only. App-wide, the only other `resize` listener is
  `components/dev/overflow-diagnostic.tsx`, which is not mounted anywhere.
- **The render loop's effect has `[]` deps**, so a second `effect running` is a genuine unmount and
  remount, never a re-fired effect.
- **The trigger correlates with the `resize` event**, not with `blur` or `visibilitychange` — both of
  those fired alone and changed nothing. It reproduced on a *window* switch with the page visible
  throughout.

**What was tried and did not work:**

1. Seeding `onScreen` from `getBoundingClientRect()` at IntersectionObserver creation. `visible` and
   `onScreen` were both already correct at mount; this was a wrong theory, twice.
2. A `ResizeObserver` on the canvas calling `fit()` + `ensureNet()`. Correct in itself — `ensureNet()`
   bails on a zero width and previously had no way back — but it did not fix the reported symptom.
3. **The hoist** (`3dd09ba`): the hero moved to child 0 of `.v2-root` so it holds one position in both
   layouts and a branch change can no longer destroy it. Correct and worth keeping regardless — it
   also fixes real 720px crossings — but the cold load still did not run.

**The one candidate never ruled out:** `dataPromise` identity. If a new promise reaches `HomeClient`
on re-render, `use(p)` re-suspends and React can discard the subtree from the nearest boundary above.
It is created in a server component so a client-side resize should not produce a new one, but that is
an assumption, not a measurement. Log its identity in the render object before assuming anything else.

**Next step if it is picked up again:** log `dataPromise` identity per render, and check whether
`HomeClient` itself remounts (does `isMobile` return to `null`?) rather than only its children.

## 2. Contacts — DONE

All five list screens now run on the shared `ListPage`. The contacts read was extracted verbatim from
`app/contacts/page.tsx` into `lib/contacts/page-read.ts` (byte-identical, verified against the source
block) so both screens see the same window onto the address book.

## 3. Mobile lost its pinned composer in the hoist

`.v2-overlay` is now shared by both layouts, so mobile uses one composer rather than its own
`.v2-sticky` variant with `full`. `.v2-frame` and `.v2-ov` are unused. If the mobile composer should
be pinned to the bottom again, that is a rule on `.v2-overlay` inside the 720px media query — not a
second component.

## 4. Two-pane list — DONE

Above 1100px inbox, contacts and orders render the list beside the selected record; below it they are
one column and a row is a link again. The three detail routes were split into a `body.tsx` the route
and the pane both render, so a detail is one implementation reachable two ways. Leads and appointments
stay single column, since their rows route to a conversation or a contact rather than to a record of
their own.

## 5. Groups 2-4 are unbuilt

Rudi (AI Employees, Knowledge, Test AI), Business (Analytics, Reports), Account (Billing, Settings,
Partner Program, Admin). Each is a route, a loader — extracted verbatim into lib/ if it is inline —
and an href filled in on a destination nav.ts already lists. Knowledge's location is still
unconfirmed: there is no app/knowledge, so it is nested under ai-employees or settings.
