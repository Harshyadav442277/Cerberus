// Local verification for judge-site/index.html. Run: node check-links.mjs
// 1. every relative href/src/poster resolves to an existing file in this folder
// 2. every in-page #anchor points at an existing id
// 3. every 0x hash / address / bare SHA-256 on the page appears in the repository's
//    evidence documents (skipped with a notice when run outside the repository)
// 4. no Stage-1 transaction hash or Stage-1 address is present on the page
// 5. wording review: print every occurrence of words that must never be claimed
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
let failures = 0;
const fail = (msg) => { failures += 1; console.log("FAIL  " + msg); };

// 1 + 2 — links
const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
const attrRe = /\b(?:href|src|poster)=["']([^"']+)["']/g;
const localFiles = new Set();
let external = 0, anchors = 0, local = 0;
for (const m of html.matchAll(attrRe)) {
  const v = m[1];
  if (/^(https?:)?\/\//i.test(v) || /^(mailto|data|tel|javascript):/i.test(v)) { external += 1; continue; }
  if (v.startsWith("#")) {
    anchors += 1;
    if (!ids.has(v.slice(1))) fail(`anchor ${v} has no matching id`);
    continue;
  }
  local += 1;
  const clean = decodeURIComponent(v.split("#")[0].split("?")[0]);
  const p = path.join(root, clean);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) fail(`relative reference ${v} does not resolve to a file`);
  else localFiles.add(clean);
}
console.log(`links: ${local} relative references (${localFiles.size} distinct files), ${anchors} in-page anchors, ${external} external URLs`);
for (const f of [...localFiles].sort()) console.log("  ok  " + f);

// external URLs must only point at GitHub, the Base Sepolia Blockscout explorer, or the project's own Vercel pages
for (const m of html.matchAll(attrRe)) {
  const v = m[1];
  if (!/^https?:\/\//i.test(v)) continue;
  if (!/^https:\/\/(github\.com\/Harshyadav442277\/Cerberus|base-sepolia\.blockscout\.com)(\/|$)/.test(v)) fail(`unexpected external URL ${v}`);
}

// 3 — hash truth check against repository documents
const repo = path.resolve(root, "..");
const sources = [
  "docs/submission/EVIDENCE.md",
  "docs/submission/FINAL_FREEZE.md",
  "README.md",
  "artifacts/judge-evidence/08_final/evidence-summary.json",
  "artifacts/judge-evidence/08_final/SHA256SUMS.txt",
  "artifacts/judge-evidence/08_final/final-verification.log",
].map((p) => path.join(repo, p));
const present = sources.filter((p) => fs.existsSync(p));
if (present.length === 0) {
  console.log("hash truth check: repository documents not found next to judge-site/ — skipped");
} else {
  const corpus = present.map((p) => fs.readFileSync(p, "utf8")).join("\n").toLowerCase();
  const hexes = new Set([
    ...[...html.matchAll(/0x[0-9a-f]{40}(?![0-9a-f])/gi)].map((m) => m[0].toLowerCase()),
    ...[...html.matchAll(/0x[0-9a-f]{64}(?![0-9a-f])/gi)].map((m) => m[0].toLowerCase()),
    ...[...html.matchAll(/(?<![0-9a-fx])[0-9a-f]{64}(?![0-9a-f])/gi)].map((m) => m[0].toLowerCase()),
    ...[...html.matchAll(/\baudit_[0-9a-f]{8}\b/g)].map((m) => m[0].toLowerCase()),
    ...[...html.matchAll(/\b(?:auth|res)_[0-9a-f-]{36}\b/g)].map((m) => m[0].toLowerCase()),
    ...[...html.matchAll(/\b(?:ec52e325|98e735cc|6d40e85b|0462558b)[0-9a-f]{32}\b/gi)].map((m) => m[0].toLowerCase()),
  ]);
  let checked = 0;
  for (const h of hexes) {
    checked += 1;
    if (!corpus.includes(h)) fail(`identifier ${h} on the page was not found in the repository evidence documents`);
  }
  console.log(`hash truth check: ${checked} identifiers on the page, all found in ${present.length} repository documents`);

  // 4 — Stage-1 hashes and addresses must not appear
  const evidenceMd = fs.readFileSync(path.join(repo, "docs/submission/EVIDENCE.md"), "utf8");
  const stage1Section = evidenceMd.split("## HISTORICAL STAGE-1 EVIDENCE")[1]?.split("## Current known limitations")[0] ?? "";
  const stage1 = new Set([...stage1Section.matchAll(/0x[0-9a-fA-F]{40,64}/g)].map((m) => m[0].toLowerCase()));
  // the AuditAnchor contract address is shared by both eras and is legitimately on the page
  stage1.delete("0x2d2d857ce3c0d5d666b7e0db3fe8067d4b4d6ff7");
  const lower = html.toLowerCase();
  let stage1Hits = 0;
  for (const h of stage1) if (lower.includes(h)) { stage1Hits += 1; fail(`Stage-1 identifier ${h} is present on the page`); }
  console.log(`stage-1 check: ${stage1.size} Stage-1 hashes/addresses screened, ${stage1Hits} present on the page`);
}

// 5 — wording review
const text = html.replace(/<style[\s\S]*?<\/style>/i, "").replace(/<[^>]+>/g, " ");
for (const word of [/immutable/gi, /MAS[- ]approved/gi, /MAS[- ]certified/gi, /production[- ]ready/gi, /production[- ]safe/gi]) {
  for (const m of text.matchAll(word)) {
    const i = m.index ?? 0;
    const ctx = text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, " ").trim();
    console.log(`review: "${m[0]}" … ${ctx}`);
  }
}
if (/production[- ]ready/i.test(text)) fail('the page says "production-ready"');

console.log(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
