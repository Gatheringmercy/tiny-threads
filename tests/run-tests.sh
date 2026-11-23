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

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
