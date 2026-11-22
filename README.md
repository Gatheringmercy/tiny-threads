# CJ sync for Precious Threads — staging folder (NOT in the repo yet)

Built 2026-11-22. This folder holds the finished CJ Dropshipping sync, ready to
be added to the Precious Threads repo. Nothing here has been pushed anywhere —
GitHub is not connected in this environment, so the branch + PR step is still
open (see "What is still blocked" below). The live store files were NOT touched.

## What is in here

| File | What it is |
|---|---|
| `scripts/cj-sync.mjs` | The sync script. Node 20+, zero dependencies. Gets a CJ access token (key in the JSON body, per CJ's own docs), searches CJ for baby products (US stock, in stock only), checks each candidate (no bulk packs, no MOQ > 1, must have a picture, must have US variants), maps it into the store's exact `products.json` schema, appends it, updates `counts.json`, and writes `cj-sync-report.md`. Caps at 10 new products per run by default. Respects CJ's 1 request/second limit. |
| `.github/workflows/cj-sync.yml` | GitHub Actions workflow. Runs daily at 14:00 UTC (06:00 PST) and on manual trigger (with `max_products` and `dry_run` inputs). Commits `products.json`, `counts.json` and `cj-sync-report.md` back; Vercel redeploys on push. Reads `CJ_API_KEY` + `CJ_EMAIL` from GitHub Secrets — the key never appears in code. |
| `tests/cj-fixture.json` | Canned CJ API responses (real envelope shapes, fake products) for local testing. No real key, no network. |
| `tests/run-tests.sh` | Local test suite. Run `bash tests/run-tests.sh` from the repo root. |

## How it was tested

- `bash tests/run-tests.sh` — **10 pass, 0 fail.** Covers: missing key fails cleanly;
  dry run leaves `products.json` untouched; bulk-pack names, MOQ > 1, no-image,
  duplicate, and failed-details items are all skipped with reasons in the report;
  price ranges map to `6.50-7.25` style costs with retail at cost x 1.5
  (`9.75-10.88`); `counts.json` recounts correctly; every new item carries all
  15 fields `index.html` reads; `price_ok` stays `false` (price to verify).
- `node --check scripts/cj-sync.mjs` — syntax OK. Workflow YAML parses OK.
- **NOT yet tested live against CJ's real API.** No key is available in this
  environment and the stored key must never be extracted. The first live run
  is the GitHub Actions manual run after Diana adds the secrets (see below).
  If the token call fails there, the run fails loudly and nothing is written.

## Where these files go in the repo

Expected repo: `Gatheringmercy/tiny-threads` (pattern matches Camellia:
`Gatheringmercy/crystalcamellia`). **Confirm the repo name when GitHub is
connected — it was not verifiable from here.**

- `scripts/cj-sync.mjs` -> repo `scripts/cj-sync.mjs`
- `.github/workflows/cj-sync.yml` -> repo `.github/workflows/cj-sync.yml`
- `tests/` -> repo `tests/` (fixture + test script, harmless to ship)
- Branch: `cj-sync`. Open a PR, do NOT merge without Diana's review.

## What is still blocked

1. **GitHub is not connected** in this environment (`/opt/hatch/bin/github
   status` = `not_connected`), and there is no local git checkout of the
   store. So no branch was created and no PR was opened. The parent agent
   needs Diana to connect GitHub (OAuth) and select the Precious Threads
   repo, then the files above can be pushed to branch `cj-sync` and the PR
   opened. Do NOT work around this with `gh auth login`, device codes, or a
   personal access token in chat — the connector doc forbids it.
2. **Diana must add two GitHub Secrets** to the repo (Settings -> Secrets and
   variables -> Actions -> New repository secret), one step at a time like the
   Stripe key in Vercel:
   - `CJ_API_KEY` — copy from CJ: My CJ > Authorization > API, the row named
     "Outlaw Underwear", Type "API Key", Status "Activated" (key starts with
     `CJ`). Paste the whole key, nothing else.
   - `CJ_EMAIL` — the email on her CJ account.
3. **First live test:** after the PR is merged, go to the repo's Actions tab
   -> "CJ sync — Precious Threads" -> "Run workflow" -> set max_products 10,
   dry_run ON first. Check the run log + the `cj-sync-report.md` it commits.
   Only then run it for real. The daily schedule only starts after the merge
   (scheduled workflows run from the default branch only).

## Decisions Diana still needs to make

- **Raise the cap?** First runs import at most 10 products. After she reviews
  the test batch, the cap can go up (workflow input or the script's `--max`).
- **Which store next?** The script's keywords are baby-only for Precious
  Threads. The same script can serve Camellia / Little Luxuries / The Guy's
  Store later with different `--keywords` — that is a separate setup per store,
  not automatic.
- **Checkout is still not wired** on Precious Threads (Buy buttons say "coming
  soon"). CJ sync only fills the catalogue; Stripe wiring is a separate step
  and needs her word on which Stripe account to use.
