#!/usr/bin/env node
/**
 * CJ Dropshipping -> Precious Threads product sync.
 *
 * Pulls baby products from CJ Dropshipping's API and appends them to the
 * store's products.json in the exact schema index.html already reads.
 *
 * How it works (CJ's own API docs, developers.cjdropshipping.com):
 *   1. POST /authentication/getAccessToken  { apiKey, email } in the JSON BODY
 *      -> accessToken (good for 180 days). The token goes in the
 *      CJ-Access-Token header on every later call.
 *   2. GET  /product/listV2  ?keyWord=...&countryCode=US&startWarehouseInventory=1
 *      -> keyword search, US stock only, in-stock only.
 *   3. GET  /product/query   ?pid=...&countryCode=US
 *      -> full details (variants, prices, images) for each candidate.
 *
 * Rules (Diana's):
 *   - Dropship only, single-piece only. Anything that looks like a bulk /
 *     multi-pack (name says "12Pcs", "Pack of", "10 Pairs", MOQ > 1) is skipped.
 *   - US warehouse preferred: countryCode=US filter + variant check.
 *   - Ready to Ship preferred (CJ's listV2 has no explicit RTS flag; in-stock
 *     US inventory is the closest the API offers, and it is recorded).
 *   - Nothing invented: every price/picture comes from CJ. price_ok stays
 *     false ("price to verify") until Diana verifies it, same as the
 *     hand-added items already in products.json.
 *   - The dry-run report lists each added item's real CJ image URL
 *     (detail.bigImage), so pictures can be filled in from the report
 *     without re-querying CJ.
 *   - First runs stay small: --max defaults to 10 products.
 *
 * Secrets (never hardcode, never log):
 *   CJ_API_KEY  - Diana's CJ API key, from GitHub Secrets in Actions.
 *   CJ_EMAIL    - Diana's CJ account email, from GitHub Secrets in Actions.
 *                 Sent alongside apiKey in the token body (CJ accepts it;
 *                 its docs list apiKey as the required field).
 *
 * Usage:
 *   node scripts/cj-sync.mjs [--max 10] [--dry-run]
 *       [--keywords "baby onesie,baby romper,..."]
 *       [--products products.json] [--counts counts.json]
 *       [--report cj-sync-report.md]
 *   node scripts/cj-sync.mjs --fixture tests/cj-fixture.json   (local test only:
 *       reads canned CJ responses instead of calling the live API)
 *
 * Probe mode: if `cj-probe.json` exists in the repo root (and no --keywords
 * flag is given), its keywords + keep/exclude name filter drive the run
 * instead of the baby defaults. Used for one-off probes (e.g. candles for
 * Pill-O-Talk). Remove or disable the file right after the probe run — the
 * daily scheduled run must never see it enabled.
 *
 * Exit codes: 0 = ok (even if 0 new products), 1 = missing key / auth / API error.
 *
 * Rate limit: CJ free accounts allow 1 request/second. This script waits
 * ~1.1s between calls.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const RATE_LIMIT_MS = 1100;

// Diana's baby keywords, in priority order. Christmas goes to Little Luxuries,
// jewelry to Camellia — this store is baby clothes + baby gift sets only.
const DEFAULT_KEYWORDS = [
  'baby onesie',
  'baby romper',
  'baby sleeper',
  'baby blanket',
  'baby dress',
  'baby hat',
  'baby shoes',
  'baby gift set',
];

// --- Optional probe config --------------------------------------------------
// A one-off probe (e.g. the 2026-11-22 candle probe for Pill-O-Talk) is
// driven by `cj-probe.json` in the repo root. When the file exists and is
// enabled, it overrides the keywords and applies a name filter; when it is
// absent or disabled, the script behaves exactly as before (baby keywords,
// no name filter). The file is a probe switch: the daily scheduled run must
// never see it enabled, so it is removed (or disabled) right after the
// probe run. Explicit --keywords on the command line always wins over it.
function loadProbeConfig() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(scriptDir, '..', 'cj-probe.json'), join(process.cwd(), 'cj-probe.json')]) {
    if (!existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf8'));
      if (cfg && cfg.enabled !== false && Array.isArray(cfg.keywords) && cfg.keywords.length > 0) {
        return {
          keywords: cfg.keywords.map(String).map((s) => s.trim()).filter(Boolean),
          keep: (cfg.keep || []).map((s) => String(s).toLowerCase()),
          exclude: (cfg.exclude || []).map((s) => String(s).toLowerCase()),
          label: cfg.label || 'probe',
        };
      }
    } catch (err) {
      console.error(`[cj] WARNING: could not parse ${p}: ${err.message}`);
    }
  }
  return null;
}

// Match a whole word (plus optional plural) in a product name.
function termRe(term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}(e?s)?\\b`, 'i');
}

// Probe name filter. Exclude terms win over keep terms (so "wax warmer" is
// out even though it contains "wax"). Returns a skip reason or null.
function probeFilterReason(name, probe) {
  const hay = name || '';
  for (const term of probe.exclude) {
    if (term && termRe(term).test(hay)) return `probe filter: excluded term "${term}" in name "${name}"`;
  }
  if (probe.keep.length > 0 && !probe.keep.some((t) => t && termRe(t).test(hay))) {
    return `probe filter: name has no kept term (candle/wax/soy): "${name}"`;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CLI args ---------------------------------------------------------------
function parseArgs(argv) {
  const args = { max: 10, dryRun: false, keywords: DEFAULT_KEYWORDS, keywordsFromCli: false, products: 'products.json', counts: 'counts.json', report: 'cj-sync-report.md', fixture: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--max') args.max = Math.max(1, parseInt(argv[++i], 10) || 10);
    else if (a === '--keywords') { args.keywords = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); args.keywordsFromCli = true; }
    else if (a === '--products') args.products = argv[++i];
    else if (a === '--counts') args.counts = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--fixture') args.fixture = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/cj-sync.mjs [--max 10] [--dry-run] [--keywords "a,b"] [--products products.json] [--counts counts.json] [--report cj-sync-report.md] [--fixture tests/cj-fixture.json]');
      process.exit(0);
    } else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  return args;
}

// --- Small helpers ----------------------------------------------------------
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'product';
}

// CJ product page URL, same shape as the hand-added CJ items already in
// products.json: https://cjdropshipping.com/product/<slug>-p-<pid>.html
function cjProductUrl(nameEn, pid) {
  return `https://cjdropshipping.com/product/${slugify(nameEn)}-p-${pid}.html`;
}

// --- Diana's filters --------------------------------------------------------
// Bulk / multi-pack signals in a product name. One of these = skip the item.
const BULK_NAME_RE = /\b(\d+\s*(pcs|pieces|pack|packs|pairs?|sets?|units?|lot|lots)|wholesale lot|bulk|dozen|multipack|multi-pack)\b/i;

function looksLikeBulk(product) {
  const name = `${product.nameEn || ''} ${product.variantKeyEn || ''}`;
  if (BULK_NAME_RE.test(name)) return `bulk-pack name: "${product.nameEn}"`;
  const moq = parseFloat(product.directMinOrderNum);
  if (!Number.isNaN(moq) && moq > 1) return `minimum order ${moq} (bulk)`;
  return null;
}

// Map a CJ product to one of this store's departments (the filters in
// index.html only know these three + Discount / Blowout).
function mapDept(nameEn, categoryName) {
  const hay = `${nameEn || ''} ${(categoryName || '')}`.toLowerCase();
  if (/(sock|anklet|hat|cap|shoe|bootie|glove|mitten|bib|headband|accessor)/.test(hay)) {
    return { dept: 'Socks & Accessories', cat: /sock/.test(hay) ? 'Socks' : 'Accessories' };
  }
  if (/(gift set|blanket|swaddle|towel set|gift box)/.test(hay)) {
    return { dept: 'Baby Gift Sets', cat: 'Baby Gift Sets' };
  }
  // Onesies, rompers, bodysuits, jumpsuits, sleepers, dresses, pants sets.
  return { dept: 'Onesies & Rompers', cat: 'Onesies & Rompers' };
}

// --- CJ API client ----------------------------------------------------------
// Shared parser for the listV2 envelope:
// data = { content: [ { productList: [...] }, ... ] }
function parseListV2(data) {
  const products = [];
  for (const block of data?.content ?? []) {
    for (const p of block.productList ?? []) products.push(p);
  }
  return products;
}

class CjClient {
  constructor(apiKey, email) {
    this.apiKey = apiKey;
    this.email = email;
    this.token = null;
  }

  async call(path, { method = 'GET', body = null } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['CJ-Access-Token'] = this.token;
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.result === false || (typeof json.code === 'number' && json.code !== 200)) {
      throw new Error(`CJ API ${method} ${path} failed: HTTP ${res.status} code=${json.code} message=${json.message || 'unknown'} requestId=${json.requestId || '-'}`);
    }
    return json.data;
  }

  async getToken() {
    // CJ reads the key from the JSON request BODY (not a header). Sending
    // email alongside apiKey matches CJ's own usage examples.
    const body = { apiKey: this.apiKey };
    if (this.email) body.email = this.email;
    const data = await this.call('/authentication/getAccessToken', { method: 'POST', body });
    if (!data?.accessToken) throw new Error('CJ getAccessToken returned no accessToken');
    this.token = data.accessToken;
    return data;
  }

  async search(keyword, page = 1, size = 20) {
    const q = new URLSearchParams({
      keyWord: keyword,
      page: String(page),
      size: String(size),
      countryCode: 'US',          // US stock only
      startWarehouseInventory: '1', // in stock only
      orderBy: '0',               // best match
      sort: 'desc',
    });
    const data = await this.call(`/product/listV2?${q}`);
    return parseListV2(data);
  }

  async details(pid) {
    const q = new URLSearchParams({ pid, countryCode: 'US' });
    return this.call(`/product/query?${q}`);
  }
}

// --- Fixture client (local test only, no network, no key) -------------------
class FixtureClient {
  constructor(fixture) { this.fixture = fixture; }
  async getToken() { return { accessToken: 'fixture-token' }; }
  async search(keyword) {
    await sleep(10);
    // Fixture stores the real listV2 envelope; parsed exactly like live data.
    return parseListV2(this.fixture.searches?.[keyword] ?? null);
  }
  async details(pid) {
    await sleep(10);
    const d = this.fixture.details?.[pid];
    if (!d) throw new Error(`fixture has no details for pid ${pid}`);
    return { ...d };
  }
}

// --- Size / style chart (Mercy's rules, 2026-11-23) -----------------------
// No "$X–$Y" ranges anywhere. Chart entries are {size, price} where price
// is the SELLING price (variant cost x 1.5) — the price the shopper sees
// and pays. The item keeps a single display price/retail too.
const BED_ORDER = ['twin', 'twin xl', 'full', 'queen', 'king', 'california king', 'cal king'];
const PLUS_RANK = { '2xl': 2, '3xl': 3, '4xl': 4, '5xl': 5, '6xl': 6 };

// Pull a size token out of a CJ variant name ("White 2XL" -> "2XL",
// "Twin" -> "Twin", "Leather" -> null). Normalised so 2X/XXL read as 2XL.
function extractSize(raw) {
  const s = String(raw || '');
  const m = s.match(/\b(twin\s*xl|california king|cal king|twin|full|queen|king|\d{1,2}-\d{1,2}m|\d{1,2}m|[2-6]t|\bxs\b|\bs\b|\bm\b|\bl\b|\bxl\b|[2-6]xl|xxxl|xxl|[2-6]x)\b/i);
  if (!m) return null;
  let t = m[0].replace(/\s+/g, ' ').trim().toUpperCase();
  if (t === 'XXL' || t === '2X') t = '2XL';
  if (t === 'XXXL' || t === '3X') t = '3XL';
  if (t === 'XXXXL' || t === '4X') t = '4XL';
  if (t === '5X') t = '5XL';
  if (t === '6X') t = '6XL';
  if (t === 'CAL KING') t = 'CALIFORNIA KING';
  // Bed sizes read as words ("Twin", "California King"); letter, baby and
  // number sizes stay uppercase ("XL", "0-3M", "2T").
  if (/^(TWIN|TWIN XL|FULL|QUEEN|KING|CALIFORNIA KING)$/.test(t)) {
    return t.split(' ').map((w) => (w === 'XL' ? 'XL' : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
  }
  return t;
}

// Plus sizes are 2XL and up (XXL counts as 2XL). S–XL, baby sizes and bed
// sizes are never plus.
function isPlusVariant(raw, size) {
  if (/plus/i.test(String(raw || ''))) return true;
  if (!size) return false;
  return Object.prototype.hasOwnProperty.call(PLUS_RANK, String(size).toLowerCase());
}

// Clothes / bedding / style-keyed (gloves etc.) / other, from name+category.
function classifyItem(nameEn, categoryName) {
  const hay = `${nameEn || ''} ${categoryName || ''}`.toLowerCase();
  if (/(sheet|duvet|comforter|pillowcase|pillow sham|bedding|bed set|quilt cover|mattress)/.test(hay)) return 'bedding';
  if (/(glove|mitten)/.test(hay)) return 'style';
  if (/(onesie|romper|bodysuit|jumpsuit|sleeper|dress|shirt|blouse|hoodie|sweater|cardigan|pants|legging|jeans|skirt|jacket|coat|shorts|t-?shirt|\btee\b|pajama|nightgown|tracksuit|swimsuit|bikini|tank top|tunic|poncho|kimono)/.test(hay)) return 'clothes';
  return 'other';
}

// One chart row per size/style label; if several variants share a label
// (e.g. White L and Black L) keep the highest price — the large's price.
function dedupeChart(entries) {
  const byLabel = new Map();
  for (const e of entries) {
    const prev = byLabel.get(e.size);
    if (!prev || parseFloat(e.price) > parseFloat(prev.price)) byLabel.set(e.size, e);
  }
  return [...byLabel.values()];
}

function orderChart(entries, kind) {
  if (kind === 'bedding') {
    return [...entries].sort((a, b) => {
      const ai = BED_ORDER.indexOf(String(a.size).toLowerCase());
      const bi = BED_ORDER.indexOf(String(b.size).toLowerCase());
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }
  if (kind === 'clothes') {
    return [...entries].sort((a, b) => (PLUS_RANK[String(a.size).toLowerCase()] || 99) - (PLUS_RANK[String(b.size).toLowerCase()] || 99));
  }
  return entries;
}

// Returns {price, retail, size_chart, chart_label, chart_default} or null
// when there is no usable price. price/retail are the single display
// values (cost / cost x 1.5); size_chart is null unless the item needs one.
function priceChart(detail, listItem, nameEn) {
  const variants = Array.isArray(detail.variants) ? detail.variants : [];
  const entries = variants
    .map((v) => {
      const cost = parseFloat(v.variantSellPrice);
      const raw = String(v.variantNameEn || '').trim();
      if (!Number.isFinite(cost) || cost <= 0) return null;
      const size = extractSize(raw);
      return { raw, size: size || raw, cost, plus: isPlusVariant(raw, size), hasSize: Boolean(size) };
    })
    .filter(Boolean);
  if (entries.length === 0) {
    const p = parseFloat(detail.sellPrice ?? listItem.sellPrice);
    if (!Number.isFinite(p) || p <= 0 || !nameEn) return null;
    return { price: money(p), retail: money(p * 1.5), size_chart: null, chart_label: null, chart_default: 'flat' };
  }
  if (!nameEn) return null;

  const kind = classifyItem(nameEn, detail.categoryName || listItem.threeCategoryName || '');
  const sell = (cost) => money(cost * 1.5);

  if (kind === 'clothes') {
    const sized = entries.filter((e) => e.hasSize);
    const nonPlus = sized.filter((e) => !e.plus);
    // Flat price: max cost among S–XL. If every sized variant is plus
    // (rare), fall back to the cheapest variant so nothing is overpriced.
    const flatPool = nonPlus.length ? nonPlus : sized;
    const flatCost = flatPool.length ? Math.max(...flatPool.map((e) => e.cost)) : Math.min(...entries.map((e) => e.cost));
    const out = { price: money(flatCost), retail: sell(flatCost), size_chart: null, chart_label: null, chart_default: 'flat' };
    const plusEntries = entries.filter((e) => e.plus);
    if (plusEntries.length > 0) {
      out.size_chart = orderChart(dedupeChart(plusEntries.map((e) => ({ size: e.size, price: sell(e.cost) }))), 'clothes');
      out.chart_label = 'Plus sizes:';
    } else if (sized.length === 0 && new Set(entries.map((e) => e.cost)).size > 1) {
      // Clothes with style/color variants only and different prices:
      // chart by style, same shape as the gloves rule.
      out.size_chart = dedupeChart(entries.map((e) => ({ size: e.raw, price: sell(e.cost) })));
      out.chart_label = 'Choose a style:';
      out.chart_default = 'first';
      out.price = money(Math.min(...entries.map((e) => e.cost)));
      out.retail = sell(Math.min(...entries.map((e) => e.cost)));
    }
    return out;
  }

  // Bedding, gloves/style, and anything else: one chart row per variant
  // when prices genuinely differ; a single price when they don't.
  const costs = entries.map((e) => e.cost);
  if (new Set(costs).size === 1) {
    return { price: money(costs[0]), retail: sell(costs[0]), size_chart: null, chart_label: null, chart_default: 'flat' };
  }
  const minCost = Math.min(...costs);
  return {
    price: money(minCost),
    retail: sell(minCost),
    size_chart: orderChart(dedupeChart(entries.map((e) => ({ size: e.size, price: sell(e.cost) }))), kind),
    chart_label: kind === 'style' ? 'Choose a style:' : 'Choose a size:',
    chart_default: 'first',
  };
}

// --- Mapping CJ -> store schema ---------------------------------------------
// Exact fields index.html reads: name, cat, sku, dept, discount, has_pic, img,
// price, retail, url, warehouse, note, source. Plus batch / price_ok /
// us_warehouse, which the existing file already carries on every item.
function mapProduct(detail, listItem, runTag) {
  const pid = String(detail.pid ?? listItem.id ?? '');
  const nameEn = (detail.productNameEn || listItem.nameEn || '').trim();
  const variants = Array.isArray(detail.variants) ? detail.variants : [];

  // Mercy's pricing rules (2026-11-23) — no "$X–$Y" ranges anywhere:
  //  - Clothes: one flat price for S–XL — the max cost among non-plus sizes
  //    (the large). Plus sizes (2XL and up) keep their own higher price
  //    from their own cost, listed in size_chart.
  //  - Bedding: a chart, Twin / Full / Queen / King, each from its own cost.
  //  - Gloves and style-keyed items: a chart keyed by style, each style
  //    from its own cost.
  //  - Anything else whose variants genuinely differ in price: a chart
  //    keyed by variant name. Variants that all cost the same get one price.
  const chart = priceChart(detail, listItem, nameEn);
  if (!chart) return null;
  const { price, retail, size_chart, chart_label, chart_default } = chart;

  const { dept, cat } = mapDept(nameEn, detail.categoryName || listItem.threeCategoryName || '');
  const img = detail.bigImage || listItem.bigImage || '';
  const usStock = variants.length > 0 || (listItem.warehouseInventoryNum ?? 0) > 0;

  const notes = ['CJ sync test import — review before live.'];
  if (!usStock) notes.push('US stock not confirmed at variant level — verify before live.');

  return {
    batch: runTag,
    cat,
    dept,
    // Flag the cheapest items for the Discount / Blowout section, same
    // pattern as the hand-added items (lowest-priced items flagged).
    // Based on the single display price the shopper sees.
    discount: parseFloat(price) <= 8,
    has_pic: Boolean(img),
    img,
    name: nameEn,
    note: notes.join(' '),
    price,
    price_ok: false, // every price is "price to verify" until Diana checks it
    retail,
    ...(size_chart ? { size_chart, chart_label, chart_default } : {}),
    sku: `CJ-${pid}`,
    source: 'CJ Dropshipping',
    url: cjProductUrl(nameEn, pid),
    us_warehouse: Boolean(usStock),
    warehouse: usStock ? 'US' : 'US — UNCONFIRMED',
  };
}

// --- Counts -----------------------------------------------------------------
function recount(products) {
  const byDept = {};
  let discount = 0;
  for (const p of products) {
    byDept[p.dept] = (byDept[p.dept] || 0) + 1;
    if (p.discount) discount += 1;
  }
  return { by_dept: byDept, discount, total: products.length };
}

// --- Main -------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  // A probe config (cj-probe.json) overrides the keywords + adds a name
  // filter, unless --keywords was given explicitly on the command line —
  // in that case the probe is fully off (no keyword override, no filter).
  let probe = loadProbeConfig();
  if (probe && args.keywordsFromCli) probe = null;
  if (probe) {
    args.keywords = probe.keywords;
    console.log(`[cj] probe mode (${probe.label}): keywords from cj-probe.json — ${args.keywords.join(', ')}`);
  }
  const runTag = `CJ sync — ${new Date().toISOString().slice(0, 10)} (test)${probe ? ' (candle probe)' : ''}`;
  const started = Date.now();

  const apiKey = process.env.CJ_API_KEY;
  const email = process.env.CJ_EMAIL || '';
  if (!args.fixture && !apiKey) {
    console.error('ERROR: CJ_API_KEY is not set. Add it as a GitHub Secret (CJ_API_KEY) — never put the key in code or in chat.');
    process.exit(1);
  }

  const productsPath = args.products;
  if (!existsSync(productsPath)) {
    console.error(`ERROR: products file not found: ${productsPath}`);
    process.exit(1);
  }
  const existing = JSON.parse(readFileSync(productsPath, 'utf8'));
  if (!Array.isArray(existing)) {
    console.error(`ERROR: ${productsPath} is not a JSON array.`);
    process.exit(1);
  }
  const knownSkus = new Set(existing.map((p) => p.sku));

  let client;
  if (args.fixture) {
    const fixture = JSON.parse(readFileSync(args.fixture, 'utf8'));
    client = new FixtureClient(fixture);
    console.log(`[fixture] testing with ${args.fixture} — no live CJ calls, no key needed.`);
  } else {
    client = new CjClient(apiKey, email);
  }

  await client.getToken();
  console.log(`[cj] signed in as ${email || '(email not provided)'} — token OK.`);
  if (!args.fixture) await sleep(RATE_LIMIT_MS);

  const added = [];
  const skipped = [];
  const seenPids = new Set();
  const probeStats = { totalResults: 0, perKeyword: [], filteredNoKeep: 0, filteredExcluded: 0 };

  outer: for (const keyword of args.keywords) {
    if (added.length >= args.max) break;
    const results = await client.search(keyword);
    console.log(`[cj] "${keyword}": ${results.length} results (US, in stock).`);
    probeStats.totalResults += results.length;
    probeStats.perKeyword.push({ keyword, total: results.length });
    if (!args.fixture) await sleep(RATE_LIMIT_MS);

    for (const item of results) {
      if (added.length >= args.max) break outer;
      const pid = String(item.id ?? '');
      if (!pid || seenPids.has(pid)) continue;
      seenPids.add(pid);

      const sku = `CJ-${pid}`;
      if (knownSkus.has(sku)) { skipped.push({ sku, reason: 'already in products.json' }); continue; }

      // Probe name filter, before the details call (saves API calls).
      if (probe) {
        const fReason = probeFilterReason(item.nameEn || '', probe);
        if (fReason) {
          skipped.push({ sku, reason: fReason });
          if (fReason.startsWith('probe filter: excluded term')) probeStats.filteredExcluded += 1;
          else probeStats.filteredNoKeep += 1;
          continue;
        }
      }

      const bulkReason = looksLikeBulk(item);
      if (bulkReason) { skipped.push({ sku, reason: bulkReason }); continue; }
      if (!item.bigImage) { skipped.push({ sku, reason: 'no product image' }); continue; }

      let detail;
      try {
        detail = await client.details(pid);
      } catch (err) {
        skipped.push({ sku, reason: `details call failed: ${err.message}` });
        continue;
      }
      if (!args.fixture) await sleep(RATE_LIMIT_MS);

      const bulkReason2 = looksLikeBulk({ ...item, ...detail });
      if (bulkReason2) { skipped.push({ sku, reason: bulkReason2 }); continue; }

      // Detail names can differ from list names — re-check the probe filter.
      if (probe) {
        const fReason2 = probeFilterReason(detail.productNameEn || item.nameEn || '', probe);
        if (fReason2) {
          skipped.push({ sku, reason: `${fReason2} (detail name)` });
          if (fReason2.startsWith('probe filter: excluded term')) probeStats.filteredExcluded += 1;
          else probeStats.filteredNoKeep += 1;
          continue;
        }
      }

      const mapped = mapProduct(detail, item, runTag);
      if (!mapped) { skipped.push({ sku, reason: 'no usable price or name from CJ' }); continue; }
      if (probe) { mapped.dept = 'Candles'; mapped.cat = 'Candles'; }

      added.push(mapped);
      console.log(`[cj] + ${mapped.sku} "${mapped.name}" $${mapped.price} -> retail $${mapped.retail} (${mapped.dept})`);
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[cj] done in ${seconds}s: ${added.length} new, ${skipped.length} skipped, ${existing.length} already in file.`);

  // Report (also written on dry runs, so Diana can review before any write).
  const lines = [
    '# CJ sync report',
    '',
    `- Run: ${new Date().toISOString()} (${args.dryRun ? 'DRY RUN — nothing written' : 'live write'})`,
    `- Keywords: ${args.keywords.join(', ')}`,
    `- Added: ${added.length} (cap: ${args.max}) — Skipped: ${skipped.length} — Already in file: ${existing.length}`,
    '',
  ];
  if (probe) {
    lines.push(
      `## Probe filter summary (${probe.label})`,
      '',
      `- Total results returned by CJ across ${args.keywords.length} keywords: ${probeStats.totalResults}`,
      ...probeStats.perKeyword.map((k) => `  - "${k.keyword}": ${k.total} results`),
      `- Filtered out by name: ${probeStats.filteredNoKeep + probeStats.filteredExcluded} (no kept term candle/wax/soy: ${probeStats.filteredNoKeep}; excluded term LED/flameless/electric/holder/warmer/lamp/fake: ${probeStats.filteredExcluded})`,
      `- Name filter kept: ${probeStats.totalResults - probeStats.filteredNoKeep - probeStats.filteredExcluded} results for further checks (bulk, image, details)`,
      '',
    );
  }
  lines.push('## Added', '');
  if (added.length === 0) lines.push('_None._', '');
  for (const p of added) {
    const chartText = p.size_chart ? `, chart: ${p.size_chart.map((e) => `${e.size} $${e.price}`).join(', ')}` : '';
    lines.push(`- **${p.name}** — SKU \`${p.sku}\`, cost $${p.price}, suggested retail $${p.retail}, ${p.dept}, pic: ${p.has_pic ? 'yes' : 'no'}, US warehouse: ${p.us_warehouse ? 'yes' : 'UNCONFIRMED'}, img: ${p.img || '(none)'}${chartText}`);
  }
  lines.push('', '## Skipped', '');
  if (skipped.length === 0) lines.push('_None._', '');
  const skipCap = probe ? 200 : 50;
  for (const s of skipped.slice(0, skipCap)) lines.push(`- \`${s.sku}\` — ${s.reason}`);
  if (skipped.length > skipCap) lines.push(`- ...and ${skipped.length - skipCap} more.`);
  lines.push('', '## What still needs Diana', '', '- Review the pictures and prices above — every new price is marked "price to verify" on the site until she checks it.', '- Cut anything that looks cheap, overseas-looking, or wrong for the store.', '- Raise the `--max` cap (currently 10) only after this test batch looks right.', '');

  if (args.dryRun) {
    console.log(lines.join('\n'));
    writeFileSync(args.report, `${lines.join('\n')}\n`);
    console.log(`[cj] dry run: report written to ${args.report}, products.json untouched.`);
    return;
  }

  const next = [...existing, ...added];
  writeFileSync(productsPath, `${JSON.stringify(next, null, 2)}\n`);
  const counts = recount(next);
  writeFileSync(args.counts, `${JSON.stringify(counts, null, 2)}\n`);
  writeFileSync(args.report, `${lines.join('\n')}\n`);
  console.log(`[cj] wrote ${added.length} new products to ${productsPath} (now ${next.length} total). Counts: ${JSON.stringify(counts)}. Report: ${args.report}`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
