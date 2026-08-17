-- ============================================================================
-- CORRECTION — the two commission re-applies of 7 Aug 2026 recorded an acknowledgement
-- that never happened.
--
-- ── WHAT WENT WRONG ─────────────────────────────────────────────────────────────────────────────────
--
-- Both YDC shipments were re-applied on 7 Aug 2026 to put the 25% supplier commission onto their
-- products — PRIMAVERA 866/4/2026 at 21:21:24Z (126 products) and B&N BN-1356 at 21:23:10Z (80).
-- Every cost figure they wrote is correct and has been verified against the invoices.
--
-- What is NOT correct is the audit record. Each entry carried a field named `shown` holding the
-- sentence for that product, and the presence of that field was treated as meaning the owner had read
-- it. He had not. The re-apply button sent the acknowledgement flag unconditionally, and the banner
-- listing the products was never on screen — the tab had been loaded before the deploy that computes
-- it. So 166 flagged products carry a claim that a human reviewed them, and no human did.
--
-- ── WHY THIS IS BEING CORRECTED RATHER THAN LEFT ────────────────────────────────────────────────────
--
-- The whole reason divergence is recomputed server-side at the moment of the write, instead of being
-- trusted from the request, is that a record asserting something that did not happen is worse than no
-- record at all: a missing artefact prompts a question, a false one ends the enquiry. Leaving this in
-- place to avoid the discomfort of amending an audit trail would preserve a lie in order to protect
-- the principle the lie already breaks.
--
-- ── WHAT THIS STATEMENT CHANGES, AND WHAT IT DOES NOT ───────────────────────────────────────────────
--
-- CHANGES, per entry:
--   `shown`        -> removed, replaced by `sentence` set to NULL. The wording is regenerable from the
--                     numbers beside it; what could not be left standing is a field whose name asserts
--                     display.
--   `acknowledged` -> added, false. Nobody confirmed these.
--
-- UNTOUCHED: productId, productName, previousCost, nextCost, delta, deltaRelative, price,
-- previousMargin, nextMargin, shapes, flagged. Every number survives exactly as written. This does not
-- recalculate anything, and it does not touch product_costs, applied_before, or any cost.
--
-- The record also gains a top-level `correction` block so a reader in six months finds a CORRECTED
-- record rather than an odd one — the shape changes from a bare array to { entries, correction },
-- which matches what lib/invoices/store.ts writes from this point on.
--
-- Run as its own statement. Nothing else belongs in this transaction.
-- ============================================================================

UPDATE landed_cost_shipments
   SET divergence_ack = jsonb_build_object(
         'entries', (
           SELECT jsonb_agg(
                    (entry - 'shown')
                    || jsonb_build_object('sentence', NULL, 'acknowledged', false)
                    ORDER BY ordinality
                  )
             FROM jsonb_array_elements(divergence_ack) WITH ORDINALITY AS t(entry, ordinality)
         ),
         'correction', jsonb_build_object(
           'correctedAt', now(),
           'what',  'The `shown` field was removed and `acknowledged` set to false on every entry. No number was altered.',
           'why',   'This shipment was re-applied on 2026-08-07 to add the 25% supplier commission. The costs written are correct and verified. The acknowledgement was not: the re-apply path sent the flag unconditionally and the banner listing these products was never rendered, because the page had been loaded before the deploy that computes it. The record therefore claimed a review that did not happen.',
           'fixedBy', 'The re-apply button now renders the sentences in the same block as the button that acknowledges them, and `acknowledged` is recorded separately from `flagged` — the first is a claim only the client can make, the second is derived from the numbers.'
         )
       )
 WHERE tenant_id = '8041c0b5-c960-48bd-a3f7-655f5a0b6434'
   AND id IN (
     '0ebd5ab6-f6ac-4696-8030-17ce30cbccd2',   -- PRIMAVERA 866/4/2026  (126 entries, 88 flagged)
     '54188c8b-6175-4f37-985f-932ec0ff6c6d'    -- B&N BN-1356           (80 entries,  78 flagged)
   )
   -- Idempotent: an already-corrected row is an object, not an array, and jsonb_array_elements would
   -- error on it. This makes a second run a no-op instead of a failure.
   AND jsonb_typeof(divergence_ack) = 'array';

-- Verify. Expect 2 rows, entries 126 and 80, acknowledged_true 0, and every flagged count unchanged
-- (88 and 78):
--
--   SELECT reference,
--          jsonb_array_length(divergence_ack->'entries')                             AS entries,
--          (SELECT count(*) FROM jsonb_array_elements(divergence_ack->'entries') e
--             WHERE (e->>'flagged')::boolean)                                        AS flagged,
--          (SELECT count(*) FROM jsonb_array_elements(divergence_ack->'entries') e
--             WHERE (e->>'acknowledged')::boolean)                                   AS acknowledged_true,
--          divergence_ack->'correction'->>'correctedAt'                              AS corrected_at
--     FROM landed_cost_shipments
--    WHERE tenant_id = '8041c0b5-c960-48bd-a3f7-655f5a0b6434'
--      AND divergence_ack IS NOT NULL;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- There is deliberately none. Restoring the `shown` field would restore the false claim, and the
-- sentences are regenerable from the numbers that were never touched.
