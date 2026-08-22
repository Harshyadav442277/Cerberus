# judge-site — public read-only evidence page

**Deployed:** https://judge-site.vercel.app (production alias of the first deployment, 22 Aug 2026).

A self-contained static site (one `index.html` with inline CSS, no frameworks, no CDNs,
no fonts, no JavaScript, no build step) that shows the 22 August 2026 hardened-path run
of Cerberus on Base Sepolia with its receipts, recordings, screenshots, verified gates,
integrity manifest and stated limitations. It exists because judges asked for a public
URL they can open on a phone.

Nothing on the page is live or interactive and no keys, tokens or environment files are
involved. Every figure and hash is copied from `docs/submission/FINAL_FREEZE.md`,
`docs/submission/EVIDENCE.md` and `artifacts/judge-evidence/08_final/evidence-summary.json`.
Stage-1 history is never presented as hardened evidence.

## Contents

| Path | What | Copied from (never moved) |
|---|---|---|
| `index.html` | the page | — |
| `media/*.webm` | 7 screen recordings, phases 0–7 | `artifacts/judge-evidence/11_videos/` |
| `screenshots/*.png` | 5 screenshots, names flattened with their phase prefix | `artifacts/judge-evidence/10_screenshots/**` |
| `assets/safr-architecture-slide.png` | README architecture slide | `docs/assets/safr-architecture-slide.png` |
| `evidence/SHA256SUMS.txt` | evidence-package manifest | `artifacts/judge-evidence/08_final/SHA256SUMS.txt` |
| `evidence/evidence-summary.json` | machine-readable run summary | `artifacts/judge-evidence/08_final/evidence-summary.json` |
| `vercel.json` | `{"cleanUrls": true}` | — |
| `.vercelignore` | keeps this README and the check script out of the deployment | — |
| `check-links.mjs` | local verification script (see below) | — |

Total size is about 15 MB, almost all of it the recordings.

## Deploy

From inside this folder:

```bash
cd judge-site
npx vercel --prod
```

No build step, no environment variables, no framework preset — choose "Other" /
static if Vercel asks. Any other static host (GitHub Pages, Netlify, an S3 bucket)
works the same way: upload the folder as-is.

## Verify before deploying

```bash
cd judge-site
node check-links.mjs
```

The script checks that every relative `href`/`src` in `index.html` resolves to a file
in this folder, that every in-page anchor exists, that every on-chain hash and address
on the page appears in the repository's evidence documents, and that no Stage-1
transaction hash is present on the page.

To confirm the copied evidence files are byte-identical to the repository package:

```bash
cd judge-site && sha256sum media/*.webm screenshots/*.png evidence/evidence-summary.json
# every digest printed must appear in evidence/SHA256SUMS.txt
```

## Refreshing the copies

If the evidence package changes (it should not — it is frozen), re-copy the files from
the paths in the table above, keep the flattened screenshot names, and update the
integrity table in `index.html` from the new `SHA256SUMS.txt`.
