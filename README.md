# Precious Threads — Vercel static site (DRAFT, not live)

Built 2026-11-21. **Do NOT publish, do NOT change DNS, do NOT cancel anything until Diana approves the preview.**

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The storefront. Soft pastel baby-boutique look (pink, baby blue, mint, cream), title "Precious Threads — Soft baby clothes", Diana's hero video + silent falling-diamonds/snowflakes background video (pastel pink/blue/mint, gold bokeh) behind the whole page, department filters + search, Discount / Blowout Sale section, Buy buttons disabled with "checkout coming soon". Loads `products.json`. No explanatory descriptions under sections, per Diana 2026-11-21. |
| `products.json` | **6 real products** with real supplier image URLs (Wona, EPROLO) or supplier product-page links (CJ, KidsBlanks). No invented products, no invented prices, no fake name-brand claims. |
| `hero.mp4` | Diana's video (8.8 MB), made 2026-11-21 — soft pastel baby boutique, onesies, sleepers, blankets, tiny shoes, hats. NOTE: the video itself still shows the old TINY THREADS sign in the footage — it will need a new hero video, or the sign re-made, before going live. |
| `bg.mp4` | Diana's second video, re-encoded silent, 1280×720, 1.7 MB — falling diamonds/snowflakes, pastel pink/blue/mint, gold bokeh, as the background behind the whole page, like Camellia. |
| `hero-poster.jpg` | Poster frame from the hero video. |
| `vercel.json` | Static-site config (clean URLs, no server functions). |
| `counts.json` | Product counts by department. |

## Product counts (from supplier files and verified web listings, not guessed)

- Onesies & Rompers 3, Socks & Accessories 2, Baby Gift Sets 1 = **6 total**.
- CJ Dropshipping (US warehouse, from Diana's own Nov 9–10 files): striped baby jumpsuit $7.87–8.11; infant safe seat mat $3.34–6.77. No picture in the file — "Picture on the supplier product page — review before live", with a link to the CJ page.
- Wona Trading: BABY rhinestone anklet $11.25 and 4-pair baby Christmas socks $36.00, both with real Wona pictures.
- EPROLO (web-verified 2026-11-21): hooded newborn onesie suit, $7.26, real picture. **Flag:** listing shows $11.20 shipping and 8–15 day YANWEN delivery — looks like China shipping; US warehouse stock is UNCONFIRMED on this listing. Verify before live.
- KidsBlanks by Zoe (US — Santa Ana, CA; web-verified 2026-11-21): Laughing Giraffe raglan long-sleeve bodysuit, 100% cotton, CPSIA certified, sizes 0–3M to 18–24M. **Plain blank onesie** (no print/design), dropship program with no minimums per the supplier. No price on the page — "Price to verify".
- Discount / Blowout Sale: 3 items flagged `discount: true` — the lowest-priced items (seat mat, jumpsuit, EPROLO onesie). No % off is claimed (no original retail price to compare).
- **Prices (Diana's motto, 2026-11-21): reasonable prices, not high markups.** Suggested retail = supplier cost × 1.5 (modest markup), shown next to the supplier cost, and every price is marked "price to verify". Nothing is a final retail price yet.

## The honest gap — NOT hundreds yet

**6 is the verified start, not hundreds.** The files Diana already has are thin for baby clothes:

- CJ Christmas files (Nov 9–10): only 2 real baby items — the jumpsuit and the seat mat above. (A women's hoodie "with baby pockets" is not a baby item and was left out.)
- Wona batches 2–5 (Nov 19): almost no baby clothes — only the anklet and the Christmas socks above.
- A La Mode: no baby items at all.
- CJ's own site lists hundreds of baby rompers, but its product and list pages return a human-verification challenge to direct fetches, and no CJ API key is available in this environment (CJ_API_KEY not set; the earlier key test timed out twice and the CJ login was rejected). Prices and pictures could not be pulled item-by-item, so nothing from there was guessed into the catalogue.
- EPROLO's public catalogue does list real baby rompers/onesies with real pages and pictures, but only one item's price ($7.26) was visible in a crawled listing, and US-warehouse stock shows as an unresolved template placeholder on its pages — so only that one item is in, with its shipping flag.
- KidsBlanks by Zoe is a real US baby-clothes supplier (Santa Ana, CA, since 2000, A+ BBB, dropship program, no minimums, California warehouse), but its product pages show no prices in a fetch, so only one item is in, price to verify.

**To reach hundreds, the next step is a dedicated baby pull (needs Diana's word):**
1. Fix the CJ login / get a working CJ API key, then run a fresh CJ US-warehouse baby pull (keywords: baby onesie, baby romper, baby sleeper, baby dress, baby hat, baby blanket, baby shoes, baby gift set) — same read-only pull pattern as the lingerie/gadget pulls.
2. A KidsBlanks catalogue pull (onesies, sleepers, rompers, blankets, hats, socks) with per-item prices from their site, once Diana confirms plain blanks are wanted — or a printed-boutique source instead.
3. EPROLO US-warehouse baby pull with per-item prices and confirmed US stock.
4. Diana's picture review of every item before it goes live — same rule as Camellia/Luxuries.

## What still needs Diana / next steps (before anything goes live)

1. **Picture review:** Wona + EPROLO pictures are in hand for 3 items; the 2 CJ items and the KidsBlanks bodysuit need their pictures pulled from the supplier pages for her to keep/cut.
2. **Price verification:** all 6 prices marked "price to verify". Verify every price in the CJ / Wona / EPROLO / KidsBlanks accounts; set final retail prices (suggested retail shown is cost × 1.5 only).
3. **Cut-or-keep calls:** the infant seat mat is baby gear, not clothing (kept as a giftable item — cut it to keep the store clothes-only); the $36 Christmas socks make a $54 retail — likely too steep; the EPROLO onesie's $11.20 shipping / 8–15 days needs a US-stock check.
4. **Fill to hundreds:** see "honest gap" above — a dedicated baby pull is needed. Nothing is added without a real picture and a confirmed dropship price.
5. **Checkout:** NOT wired yet, on purpose. Buy buttons are disabled. Stripe is the intended route for a gift/baby store (same question as Camellia: same WunderBar EuroShop Stripe account or a separate one — Diana to confirm in writing).
6. **Domain:** preciousthreads.shop — registered 2026-11-21 (Diana renamed the store Precious Threads because Tiny Threads was already taken). Do NOT flip DNS or deploy until the Vercel preview is approved and checkout is decided.

## Rules that still stand

- Diana must SEE real pictures before anything sells; drafts until she says go live.
- Dropship only — nothing she has to ship out or buy in bulk. No DropshipZone (Australia-only, no US shipping). No Faire (Faire does not dropship).
- Baby clothes only: onesies, sleepers, rompers, dresses, hats, blankets, tiny shoes, baby gift sets.
- Zero money out. Vercel free tier only.
- No Shopify. No fake name-brand claims. No vendor contact / signup / payment without Diana's word.
- No explanatory descriptions under sections. Reasonable prices, modest markups only (Diana, 2026-11-21).
