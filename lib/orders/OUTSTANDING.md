# Orders — piece types, and what's outstanding

Written 21 Aug 2026, at the point the order form learned what the piece is. Everything below is
known-incomplete, a decision deliberately taken, or a thing somebody will ask about later and deserve
a written answer to. What works is in the code comments, in `lib/orders/product-types.ts`, and in
`supabase/migrations/add_order_product_types.sql`.

**State, 21 Aug 2026.** Code merged to main. **`add_order_product_types.sql` NOT yet run** — until it
is, `product_type` does not exist, the app's defensive reads return null for it everywhere, and the
form behaves exactly as it did before. `add_letterhead_designs.sql` HAS been run (verified against the
database: `letterhead_style` = 'band', the strip URL is set, and the T.G. Designs profile row exists).
Nothing has been typed into the piece-type field by a person yet.

---

## 1. HER RIVIERA LIST WAS RENAMED — the answer, if she ever asks

**This is the one thing in this work that edits data Tatiana typed, and it is written down here so the
answer exists before the question does.**

She created an option list and called it **"Timeless Dreams Riviera Diamond Necklace"**, containing
`Necklace Length · 16'' · 17'' · 18'' · 20'' · 22''`. That was the right instinct — a necklace has a
length the way a ring has a size — and it never appeared on an order, because the form renders only
the machine keys it knows and hers was `timeless_dreams_riviera_diamond_necklace`. Her work was saved
and invisible. **A gap in the form, not a mistake she made.**

`add_order_product_types.sql` promotes it in place:

| | before | after |
|---|---|---|
| key | `timeless_dreams_riviera_diamond_necklace` | `length` |
| label | Timeless Dreams Riviera Diamond Necklace | Length |
| options | 6 | 6 — all kept |
| "Necklace Length" | active | **deactivated**, not deleted |

So in Settings the list she named after a product now reads **Length**, and on an order it is the
dropdown behind the Length field for necklaces, bracelets and tennis pieces.

**Why rename rather than leave hers alone and seed a second list:** two lists of the same six values,
one working and one inert, is worse than one renamed list — she would have to notice which of them the
form was reading. **Why deactivate "Necklace Length" rather than delete it:** it was a heading she
typed because the list's own name was taken by a product. It disappears from new orders, any order
carrying it keeps its text, and she can revive it from Settings in one click.

**If she asks where that list went:** it is still hers, still has all six lengths, and is now called
Length. Nothing was deleted. The reverse block at the foot of the migration puts the old name back.

## 2. A COLUMN NAMED `center_stone_carat` HOLDS TOTALS FOR HALF THE TYPES

Deliberate, and the reasoning is in full in `lib/orders/product-types.ts`. In short: her 17ct and 11ct
tennis-necklace totals are already sitting in that column, and re-labelling the field per type is the
only design under which those two numbers never have to move. A second column would mean migrating the
exact rows this work exists for, and leaving two places that could each hold the truth for any row
nobody migrated.

**The debt is the name.** A developer reading the schema alone will believe every value in that column
is a centre stone. Four of the eight types put a total there. The labels are correct on the form and on
the document; only the column name lies.

**When it would be worth paying off:** if a type ever needs a centre stone AND a separate total — a
tennis bracelet with a feature stone, say. That is the case the single column genuinely cannot express,
and it is the signal to add the second one and migrate rather than to keep stretching this.

## 3. THE TYPE IS INFERRED FROM THE PRODUCT NAME WHEN THE FIELD IS EMPTY

Nothing was backfilled: `product_type` is null on all 18 of her existing lines and stays null. The app
reads the product NAME instead, so those rows lay out and print correctly with no row rewritten and
nothing claiming she said something she did not.

**The name only. Never the description or the custom spec** — a ring described as "to match her tennis
bracelet" is a ring.

Measured against her 18 rows: **16 read correctly**, including her misspelling "Tennis Nechlase"
(the word that decides it is the one she got right). The two it cannot read are the lines she named
after their price:

- **"1000"** — a ring, evidenced only by its ring size of 6.50.
- **"3000"** — a tennis necklace, and the description says so in capitals. It keeps showing its 6ct
  under "Center weight" until somebody picks a type on it.

Both keep the entire form, which is what they have today. **Symptom to watch for:** somebody reporting
that "the form changed on some lines and not others" — that is these two.

**A backfill is available and was not taken.** Once she has confirmed the eight types read right, a
one-off `UPDATE` from the same inference would make 16 of the 18 explicit. Do it then, if at all, and
never as part of shipping the feature.

## 4. THE TYPES ARE HER DATA. THE FIELD SETS ARE NOT.

She adds "Anklet" in Settings without a deploy, and it appears on the form immediately — showing
**every** field under today's labels, because `fieldsFor` falls back to the ring set for anything it
does not recognise. That is deliberate: a type nobody has described should never be *narrower* than
what exists, only never yet tailored.

The mapping from her words to a field set reads the words rather than matching an id
(`productTypeKey`), so renaming "Tennis necklace" to "Riviera" keeps working. **It is a heuristic and
it will be wrong eventually** — the ordering that tests earrings before rings, because "earring"
contains "ring", is the shape of that fragility. It is asserted in `product-types.test.ts`.

**The open question:** whether field sets should become her data too. They should not yet. Nobody has
described what an anklet or a brooch needs, and a table of per-type field visibility she can edit is a
lot of screen for a question that has not been asked.

## 5. NOT YET EXERCISED BY A PERSON

- **No piece type has ever been picked.** The migration is unrun, so the dropdown does not render at
  all: it is hidden unless the tenant actually has a `product_type` list, because a select whose only
  entry is the empty one is a control nobody can use. The field labels still follow what the product
  NAME says in the meantime, which is why her tennis rows read "Total weight" before the SQL is run.
- **The Length dropdown has never been used**, and the fallback matters: with no `length` list the
  field stays the free-text box it is today. Every tenant except TG is in that state.
- **The hidden-but-filled rule** — a field the type does not offer still renders when the line already
  holds a value in it — is unit-tested and has never been seen on screen. It is the rule that stops
  something she typed vanishing off the form while sitting in the database, so it is the one to look at
  first on a real order.
- **The factory approval page** now carries `productType` in its public projection. No factory has
  received one.

## 6. SMALL AND KNOWN

- **The three plated fashion pieces** (Deep Blue Bezel Lariat, Turquoise Bezel Lariat, Luxe Tube
  Baguette Stretchy Bracelet) carry no structured spec at all — everything, including "15.5 inches plus
  2 inch extension", is prose in the description. Types will not fix that; it is a second product line
  that arrived as marketing copy, and it needs a conversation rather than a column.
- **`measurements` still holds three quantities** — stone dimensions, band width and length — and is
  named per type rather than split. Same trade as §2, same signal to revisit: a piece that needs two of
  them at once.
- **Quantity is 1 on all 18 rows.** Earrings are sold as a pair and priced as a pair; if she ever
  records a pair as quantity 2, `totalCarats` will double the pair's total weight. Nobody has done it.
