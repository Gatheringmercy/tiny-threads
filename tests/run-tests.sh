#!/usr/bin/env bash
# Local tests for scripts/cj-sync.mjs. No network, no real CJ key.
# Run from the repo root:  bash tests/run-tests.sh
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }

echo "== 1. Missing key fails cleanly (no fixture, no env) =="
OUT=$(env -u CJ_API_KEY -u CJ_EMAIL node scripts/cj-sync.mjs --products /tmp/does-not-matter.json 2>&1)
CODE=$?
if [ "$CODE" -eq 1 ] && echo "$OUT" | grep -q "CJ_API_KEY is not set"; then ok "exits 1 with a clear missing-key message"; else bad "missing-key run (code=$CODE): $OUT"; fi

echo "== 2. Fixture dry run (nothing written) =="
rm -rf /tmp/cj-test && mkdir -p /tmp/cj-test
cp ../tiny-threads-vercel/products.json /tmp/cj-test/products.json
cp ../tiny-threads-vercel/counts.json /tmp/cj-test/counts.json
cp ../tiny-threads-vercel/products.json /tmp/cj-test/products.before.json
OUT=$(node scripts/cj-sync.mjs --fixture tests/cj-fixture.json --max 3 --dry-run \
  --keywords "baby onesie,baby blanket,baby hat,baby dress" \
  --products /tmp/cj-test/products.json --counts /tmp/cj-test/counts.json \
  --report /tmp/cj-test/report.md 2>&1)
CODE=$?
[ "$CODE" -eq 0 ] && ok "dry run exits 0" || bad "dry run exit code $CODE: $OUT"
cmp -s /tmp/cj-test/products.json /tmp/cj-test/products.before.json && ok "dry run leaves products.json untouched" || bad "dry run changed products.json"
grep -q "Cute Cotton Baby Onesie Bodysuit" /tmp/cj-test/report.md && ok "report lists the onesie" || bad "report missing onesie"
grep -q "img: https://cf.cjdropshipping.com/quick/product/onesie-1001.jpg" /tmp/cj-test/report.md && ok "report lists the onesie image URL" || bad "report missing onesie image URL"
grep -q "bulk-pack name" /tmp/cj-test/report.md && ok "report shows bulk-pack skip (12Pcs socks)" || bad "report missing bulk skip"
grep -q "minimum order 5" /tmp/cj-test/report.md && ok "report shows MOQ skip (romper)" || bad "report missing MOQ skip"
grep -q "already in products.json" /tmp/cj-test/report.md && ok "report shows duplicate skip (striped jumpsuit)" || bad "report missing duplicate skip"
grep -q "no product image" /tmp/cj-test/report.md && ok "report shows no-image skip (hat)" || bad "report missing no-image skip"
grep -q "details call failed" /tmp/cj-test/report.md && ok "report shows details-failure skip (sleeper)" || bad "report missing details-failure skip"

echo "== 3. Fixture live run (writes to a COPY) =="
OUT=$(node scripts/cj-sync.mjs --fixture tests/cj-fixture.json --max 3 \
  --keywords "baby onesie,baby blanket,baby hat,baby dress" \
  --products /tmp/cj-test/products.json --counts /tmp/cj-test/counts.json \
  --report /tmp/cj-test/report.md 2>&1)
CODE=$?
[ "$CODE" -eq 0 ] && ok "live run exits 0" || bad "live run exit code $CODE: $OUT"

node -e '
const fs = require("fs");
const products = JSON.parse(fs.readFileSync("/tmp/cj-test/products.json", "utf8"));
const counts = JSON.parse(fs.readFileSync("/tmp/cj-test/counts.json", "utf8"));
const assert = (cond, msg) => { if (!cond) { console.error("  FAIL - " + msg); process.exitCode = 1; } else console.log("  ok - " + msg); };
// 6 existing + 3 new = 9
assert(products.length === 9, `9 products total (got ${products.length})`);
assert(counts.total === 9, `counts.total is 9 (got ${counts.total})`);
assert(counts.by_dept["Onesies & Rompers"] === 5, `Onesies & Rompers is 5 (3 existing + onesie + dress, got ${counts.by_dept["Onesies & Rompers"]})`);
assert(counts.by_dept["Baby Gift Sets"] === 2, `Baby Gift Sets is 2 (got ${counts.by_dept["Baby Gift Sets"]})`);
assert(counts.discount === 4, `discount count is 4 (got ${counts.discount})`);
// Every product has exactly the fields index.html reads (+ batch/price_ok/us_warehouse).
const needed = ["batch","cat","dept","discount","has_pic","img","name","price","price_ok","retail","sku","source","url","us_warehouse","warehouse"];
for (const p of products) {
  for (const f of needed) assert(f in p, `field ${f} present on ${p.sku}`);
  assert(typeof p.price_ok === "boolean", `price_ok is boolean on ${p.sku}`);
}
const onesie = products.find(p => p.sku === "CJ-1001");
assert(onesie.price === "7.25", `onesie price is the large-size price 7.25 (got ${onesie.price})`);
assert(onesie.retail === "10.88", `onesie retail is the large-size price 10.88 (got ${onesie.retail})`);
assert(onesie.dept === "Onesies & Rompers", `onesie dept is Onesies & Rompers (got ${onesie.dept})`);
assert(onesie.discount === true, "onesie flagged discount (cheapest)");
assert(onesie.url === "https://cjdropshipping.com/product/cute-cotton-baby-onesie-bodysuit-p-1001.html", `onesie URL shape (got ${onesie.url})`);
assert(onesie.price_ok === false, "onesie price_ok is false (price to verify)");
assert(onesie.batch.includes("CJ sync"), "onesie batch is marked as a sync import");
assert(!onesie.size_chart, "onesie has no size_chart (flat price, no plus sizes)");
const blanket = products.find(p => p.sku === "CJ-1006");
assert(blanket.dept === "Baby Gift Sets", `blanket dept is Baby Gift Sets (got ${blanket.dept})`);
assert(blanket.price === "9.99" && blanket.retail === "14.99", `blanket price/retail 9.99/14.99 (got ${blanket.price}/${blanket.retail})`);
assert(blanket.discount === false, "blanket not flagged discount");
const dress = products.find(p => p.sku === "CJ-1008");
assert(dress && dress.dept === "Onesies & Rompers", "dress added under Onesies & Rompers");
// No bulk / duplicate / no-image items leaked in.
assert(!products.some(p => p.sku === "CJ-1002"), "12Pcs socks NOT imported");
assert(!products.some(p => p.sku === "CJ-1003"), "MOQ-5 romper NOT imported");
assert(!products.some(p => p.sku === "CJ-1004"), "no-image hat NOT imported");
assert(products.filter(p => p.sku === "CJ-1363713977607131136").length === 1, "striped jumpsuit still appears exactly once");
'
[ "$?" -eq 0 ] || FAIL=$((FAIL+1))

echo "== 4. Fixture chart run (bedding, plus sizes, gloves) =="
rm -rf /tmp/cj-test2 && mkdir -p /tmp/cj-test2
cp ../tiny-threads-vercel/products.json /tmp/cj-test2/products.json
cp ../tiny-threads-vercel/counts.json /tmp/cj-test2/counts.json
OUT=$(node scripts/cj-sync.mjs --fixture tests/cj-fixture.json --max 5 \
  --keywords "baby bedding,plus hoodie,winter gloves" \
  --products /tmp/cj-test2/products.json --counts /tmp/cj-test2/counts.json \
  --report /tmp/cj-test2/report.md 2>&1)
CODE=$?
[ "$CODE" -eq 0 ] && ok "chart run exits 0" || bad "chart run exit code $CODE: $OUT"
grep -q "Twin \$60.00" /tmp/cj-test2/report.md && ok "report lists the bedding chart (Twin \$60.00)" || bad "report missing bedding chart"
grep -q "2XL \$21.00" /tmp/cj-test2/report.md && ok "report lists the plus-size chart (2XL \$21.00)" || bad "report missing plus-size chart"

node -e '
const fs = require("fs");
const products = JSON.parse(fs.readFileSync("/tmp/cj-test2/products.json", "utf8"));
const assert = (cond, msg) => { if (!cond) { console.error("  FAIL - " + msg); process.exitCode = 1; } else console.log("  ok - " + msg); };
const moneyRe = /^\d+\.\d{2}$/;
const chartOk = (p) => Array.isArray(p.size_chart) && p.size_chart.every((e) => typeof e.size === "string" && moneyRe.test(e.price));
// No "$X–$Y" range anywhere on the items THIS run added. (The copy of
// products.json already holds older hand-added items with range strings
// in their price fields — those stay as they are; they are not sync output
// and this run does not touch them.)
for (const sku of ["CJ-1010", "CJ-1011", "CJ-1012"]) {
  const p = products.find((x) => x.sku === sku);
  assert(p && moneyRe.test(p.price) && moneyRe.test(p.retail), `single price, no range on ${sku} (${p && p.price}/${p && p.retail})`);
  if (p && p.size_chart) assert(chartOk(p), `size_chart entries are {size, price} on ${sku}`);
}
// Bedding: one row per bed size, each from its own cost, display = Twin.
const sheets = products.find(p => p.sku === "CJ-1010");
assert(sheets && sheets.price === "40.00" && sheets.retail === "60.00", `sheets display price is Twin 40.00/60.00 (got ${sheets && sheets.price}/${sheets && sheets.retail})`);
assert(sheets && sheets.size_chart && sheets.size_chart.length === 4, `sheets chart has 4 rows (got ${sheets && sheets.size_chart && sheets.size_chart.length})`);
assert(sheets && JSON.stringify(sheets.size_chart.map(e=>e.size)) === JSON.stringify(["Twin","Full","Queen","King"]), `sheets chart order is Twin/Full/Queen/King (got ${sheets && JSON.stringify(sheets.size_chart.map(e=>e.size))})`);
assert(sheets && sheets.size_chart[0].price === "60.00" && sheets.size_chart[1].price === "75.00" && sheets.size_chart[2].price === "90.00" && sheets.size_chart[3].price === "105.00", `sheets chart prices 60.00/75.00/90.00/105.00 (got ${sheets && sheets.size_chart.map(e=>e.price).join("/")})`);
assert(sheets && sheets.chart_label === "Choose a size:" && sheets.chart_default === "first", "sheets chart_label/chart_default");
// Plus hoodie: flat S–XL at the large (11.00), plus sizes keep their own price.
const hoodie = products.find(p => p.sku === "CJ-1011");
assert(hoodie && hoodie.price === "11.00" && hoodie.retail === "16.50", `hoodie flat S-XL price is the large 11.00/16.50 (got ${hoodie && hoodie.price}/${hoodie && hoodie.retail})`);
assert(hoodie && hoodie.size_chart && hoodie.size_chart.length === 2, `hoodie chart has only the 2 plus sizes (got ${hoodie && hoodie.size_chart && hoodie.size_chart.length})`);
assert(hoodie && hoodie.size_chart[0].size === "2XL" && hoodie.size_chart[0].price === "21.00" && hoodie.size_chart[1].size === "3XL" && hoodie.size_chart[1].price === "24.00", `hoodie plus prices 2XL 21.00 / 3XL 24.00 (got ${hoodie && JSON.stringify(hoodie.size_chart)})`);
assert(hoodie && hoodie.chart_label === "Plus sizes:" && hoodie.chart_default === "flat", "hoodie chart_label/chart_default");
// Gloves: chart keyed by style, display = cheapest style.
const gloves = products.find(p => p.sku === "CJ-1012");
assert(gloves && gloves.price === "2.46" && gloves.retail === "3.69", `gloves display price is cheapest style 2.46/3.69 (got ${gloves && gloves.price}/${gloves && gloves.retail})`);
assert(gloves && gloves.size_chart && gloves.size_chart.length === 3, `gloves chart has 3 styles (got ${gloves && gloves.size_chart && gloves.size_chart.length})`);
assert(gloves && gloves.size_chart.find(e=>e.size==="Leather").price === "35.58" && gloves.size_chart.find(e=>e.size==="Knit").price === "3.69" && gloves.size_chart.find(e=>e.size==="Fleece").price === "7.50", `gloves style prices Leather 35.58 / Knit 3.69 / Fleece 7.50 (got ${gloves && JSON.stringify(gloves.size_chart)})`);
assert(gloves && gloves.chart_label === "Choose a style:" && gloves.chart_default === "first", "gloves chart_label/chart_default");
'
[ "$?" -eq 0 ] || FAIL=$((FAIL+1))

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
