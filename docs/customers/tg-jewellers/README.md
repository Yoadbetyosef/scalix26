# TG Jewellers — customer reference material

Tatiana, Vancouver BC. Two companies under one tenant:

- **TG Jewellers** — retail, tgjewellers.com
- **TG Designs** — B2B, tg-designs.com, from a Granville suite, under a toll-free number the retail
  side does not publish

The divergence between those two contact sets is deliberate — she confirmed it. Nothing in the app
merges them: each letterhead carries its own, in `letterhead_profiles`.

## What is here

- `letterhead-tg-designs.jpg` — the second letterhead, as she supplied it. Everything in the `rule`
  design was measured off this file: the header hairline at 23.8% of the page, the footer band at
  94.9%, the red `#CB0B24`, the column positions. Reference only; nothing serves it.

## What belongs here

Reference material only: her brand guide, and the sample estimate from her previous CRM showing the
layout she wants. These are read by whoever works on her issues; nothing here is served.

## What does NOT belong here

**Her logo files.** They go through the branding modal on a document page (`/api/orders/logo-upload`)
into storage, exactly like every other tenant's. Committing one tenant's assets to the repo would make
her a special case in a product whose whole point is that she is not one — and the document renderer
reads the uploaded URL, not the filesystem, so a committed file would not even be used.

### The one exception, and it is on purpose

`public/letterhead/ring-strip.jpg` — the band of jewellery photography that prints above the footer —
IS committed and IS served. It sits uneasily beside the rule above, so:

- The renderer does **not** know about it. It reads `studio_doc_settings.letterhead_strip_url`, and
  her row points at that path. Any tenant can point theirs at their own upload instead.
- It is committed because there is no upload path for it yet; the branding modal takes a URL, not a
  file. When one exists, move the file into storage, change her column, and delete it from `public/`.
- It is 482px wide, which is 57dpi across 8.5in of paper. It will look soft in print. The fix is a
  file at least 2550px wide, and it needs nothing but a new URL in that column.
