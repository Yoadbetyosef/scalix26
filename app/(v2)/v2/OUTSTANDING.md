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

## 2. Contacts has no v2 list page

The other four (`leads`, `inbox`, `appointments`, `orders`) run on the shared `ListPage`. Contacts
does not, because its rows come from a query written inline in `app/contacts/page.tsx` with paging and
search — the same situation `getDashboardData` was in before it moved to `lib/`. It needs that same
verbatim extraction, not a reimplementation that quietly differs from the page it mirrors.

## 3. Mobile lost its pinned composer in the hoist

`.v2-overlay` is now shared by both layouts, so mobile uses one composer rather than its own
`.v2-sticky` variant with `full`. `.v2-frame` and `.v2-ov` are unused. If the mobile composer should
be pinned to the bottom again, that is a rule on `.v2-overlay` inside the 720px media query — not a
second component.
