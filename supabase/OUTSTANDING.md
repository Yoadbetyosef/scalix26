# The schema — what's outstanding

Written 23 Aug 2026, at the point the drift check was built. Everything below is known-incomplete or
a decision deliberately deferred. What works is in `scripts/verify-schema-drift.mjs` and
`schema-drift.test.ts`.

**State, 23 Aug 2026.** 221 relations live, 153 declared by the repository, **69 tables in production
that nothing in this repository creates**, 0 declared-but-absent. The drift check is built and
passing. The baseline is not, and §1 is why.

---

## 1. THERE IS STILL NO BASELINE — the one that is owed

`supabase/schema-inventory.json` is an **inventory**, not a schema dump, and it says so in its first
field. It lists every relation and nothing about how any of them is shaped: no constraints, no
indexes, no RLS policies, no triggers, no functions, no defaults, no sequences. **A fresh environment
cannot be built from it.** That was half the reason for wanting a baseline and it is the half still
missing.

### Why it was not taken

Two independent blockers, both hit on 23 Aug:

- **No `pg_dump` on this machine, and it cannot be installed the ordinary way.** `brew install libpq`
  has no bottle for macOS 12, so Homebrew falls back to building from source, starting with `icu4c`.
  That failed on disk *and* Homebrew declined the platform outright: *"You are using macOS 12. We (and
  Apple) do not provide support for this old version."* Nothing was installed. `psql` and the Supabase
  CLI are absent too.
- **No database connection string.** Not in `.env.local`, not in a `supabase/config.toml` (the project
  is not linked in-repo), not anywhere on disk — and not findable by the person who owns the project
  either. The `SUPABASE_SERVICE_ROLE_KEY` is a JWT for PostgREST and is not a Postgres login.

### What it would take, cheapest first

1. Put the connection string in `.env.local` as `SUPABASE_DB_URL`. It is in the Supabase dashboard
   under **Project Settings → Database**.
2. `npx supabase db dump --db-url "$SUPABASE_DB_URL" --schema-only > supabase/baseline.sql`. The CLI
   is a prebuilt Go binary from npm — no compiler, no Homebrew, nothing to build. `.temp/cli-latest`
   says v2.115.0 has already been fetched here once.
3. Commit it, and change §2 of this file from "inventory" to "baseline".

Postgres.app also ships a prebuilt `pg_dump` and needs about a gigabyte, which this disk did not have.

**Until then:** the folder plus `schema.sql` describe 153 of 221 relations, and a new environment
built from them would be missing 69 tables and every constraint on the rest.

## 2. THE DRIFT CHECK IS TWO HALVES, AND ONLY ONE RUNS UNSUPERVISED

`scripts/verify-schema-drift.mjs` hits production and needs the service key, so a person runs it.
`schema-drift.test.ts` asserts the committed inventory and the declaring files still agree, and runs
anywhere. **New drift only becomes visible when somebody regenerates the inventory** — the test makes
regenerating it honest, it does not make it happen.

There is no CI in this repository (`.github/workflows` does not exist), so nothing runs either half on
a schedule. When CI arrives, the script belongs in it with the key in the environment.

## 3. NO LEDGER — deferred on purpose

No `schema_migrations` table; nothing records what ran. This is why the half-applied core migrations
cannot be diagnosed: `companies`, `product_variants`, `sales_document_lines` and `proposals` exist
while `customers`, `products`, `sales_documents`, `workflows`, `terminology_overrides` and
`categories` do not, and no statement anywhere says which file stopped where.

Deliberately not built: a ledger records migrations run **from here on**, and the question being asked
is about ones already run. It is worth adding the day migrations start being run by something other
than a person pasting into an editor.

## 4. THE 69, BY WHERE THEY CAME FROM

| group | n | origin |
|---|---|---|
| `commerce_*` | 28 | a numbered series that is not in this repository. `add_quickbooks_connections.sql` says *"Depends on migrations 1–7"* — migrations nobody here can read |
| core / proposals / workflow | 31 | run by hand off `scalix-core-*`, which have never merged |
| `inventory_*` | 6 | the inventory module |
| singles | 4 | `estimates`, `invoices`, `quotes`, `payment_allocations` |

**The sharpest edge:** `sales_document_lines` carries `trg_lines_only_on_draft`, created by
`add_document_freeze.sql`, which IS on main. Main already stands on schema main does not own — so the
core stack is not only unmerged code, it is schema main is already depending on.

## 5. SMALL AND KNOWN

- **The parser reads prose.** It strips comments and quoted literals first, and both removals were
  earned: the word "would" after "create table" in a sentence, and the format string inside the
  `referral_clicks` partition `DO` block, were each being read as a table name.
- **`referral_clicks_default` is a named exception.** A real partition that PostgREST never publishes
  separately from its parent, so it would otherwise be reported missing forever.
- **The two parsers are duplicated,** in the script and in the test, because the script reads
  `.env.local` and sharing it would drag a service key into the test run. A test asserts the two
  regexes match, which is what stops the copies diverging.
- **`supabase/schema.sql` is a declaring file and was missed on the first pass** — nine founding
  tables were reported as created by nothing for about an hour. Any future declaring file has to be
  added to `sources` in the script and `files` in the test, or it will read as drift.
