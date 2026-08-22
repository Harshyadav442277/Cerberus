# Dependency Security Audit

**Package manager:** pnpm 11.21.0 (`corepack pnpm audit`)
**Audited:** 2026-08-19, against the workspace lockfile at `pnpm-lock.yaml`
**Result after remediation:** `No known vulnerabilities found`

Re-run at any time with:

```bash
corepack pnpm audit
```

---

## Before

The audit at the start of this remediation pass reported **8 vulnerabilities:
5 high, 2 moderate, 1 low**.

An earlier review had recorded "6 vulnerabilities: 4 high, 2 moderate". That count
was stale — new advisories had been published against the same dependency tree since.
The table below is the audit as it actually stood, not the remembered figure.

| Package | Severity | Advisory | Direct / transitive | Runtime or dev | Path |
| --- | --- | --- | --- | --- | --- |
| `postcss` | high | GHSA-6g55-p6wh-862q — arbitrary file read via attacker-controlled `sourceMappingURL` | transitive | build-time | `apps/dashboard > next > postcss` |
| `postcss` | high | (incomplete-fix follow-up, `<=8.5.17`) | transitive | build-time | `apps/dashboard > next > postcss` |
| `postcss` | moderate | GHSA-fxqj-rqcc-2cmp — incomplete fix of the above | transitive | build-time | `apps/dashboard > next > postcss` |
| `postcss` | moderate | GHSA-qx2v-qp2m-jg93 — XSS via unescaped `</style>` in stringify output | transitive | build-time | `apps/dashboard > next > postcss` |
| `nanoid` | high | predictable id generation (`<3.3.18`) | transitive | build-time | `… > postcss > nanoid` (8 paths, all via postcss) |
| `sharp` | high | GHSA-f88m-g3jw-g9cj — inherited libvips CVEs | transitive, **optional** | runtime (unused) | `apps/dashboard > next > sharp` |
| `tmp` | high | GHSA-ph9p-34f9-6g65 — path traversal via unsanitized prefix/postfix | transitive | **dev only** | `contracts > solc > tmp` |
| `tmp` | low | GHSA-52f5-9888-hmc6 — symlink write via `dir` parameter | transitive | **dev only** | `contracts > solc > tmp` |

### Reachability

None of these sat on the payment path. Worth stating precisely, because "high
severity" and "exploitable here" are different claims:

- **`postcss` / `nanoid`** are Tailwind and Next.js CSS tooling. They process
  stylesheets **at build time**. Both advisories require attacker-controlled CSS
  input; this project's CSS is authored in-repo. Not reachable from an agent
  proposal, a merchant response, or any network input at runtime.
- **`sharp`** is Next.js's optional image-optimization backend. This dashboard serves
  no user-supplied images and does not use `next/image` optimization. It is an
  optional dependency that the application never invokes.
- **`tmp`** is pulled in by `solc` and is reached only when a developer runs
  `npm run contracts:compile`. It is absent from every runtime process.

No advisory touched `viem`, `x402`, `pg`, `express`, or `zod` — the libraries that
are actually on the money path.

---

## After

Every finding was fixed by raising the transitive version through pnpm `overrides` in
[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml). No direct dependency was changed,
no major version was forced, and neither Next.js nor the x402 client was touched:

```yaml
overrides:
  postcss: ">=8.5.23"
  nanoid: ">=3.3.18"
  tmp: ">=0.2.6"
  sharp: ">=0.35.0"
```

Overrides were chosen over `pnpm audit --fix` deliberately. The vulnerable packages
are pinned by Next.js and solc, so the alternative was a major-version bump of the
framework, which is exactly the "blindly force-upgrade and break x402 or Next.js"
outcome that had to be avoided this close to a demo.

### Verification after the upgrade (historical snapshot, 19 August 2026)

The figures in this table are the **historical snapshot taken at the dependency
upgrade on 19 August 2026**, not the current gate. The suite subsequently grew to 363
tests / 72 suites, then 381 / 78 at the final release remediation, and stands at
**384/384 tests across 78 suites** at the freeze pass, with the red team at **12/12
classes, 70 assertions**; the audit result is unchanged (clean at the freeze pass and
in CI run [32301340842](https://github.com/Harshyadav442277/Cerberus/actions/runs/32301340842)).
The current gate is in [FINAL_FREEZE.md](FINAL_FREEZE.md) and the README's "Current
finalist build" section, which are authoritative.

Raising a transitive dependency is only safe if the build still works, so each of
these was re-run against the overridden tree:

| Check | Command | Result at the 19 August 2026 snapshot | Current (freeze pass) |
| --- | --- | --- | --- |
| Audit | `corepack pnpm audit` | **No known vulnerabilities found** | **No known vulnerabilities found** |
| Types | `npm run typecheck` | clean | clean |
| Tests | `npm test` | 330/330, 61 suites | **384/384, 78 suites** |
| Adversarial | `npm run adversarial` | 12/12 classes, 80 assertions | 12/12 classes, 80 assertions |
| Red team | `npm run redteam` | 9/9 classes, 60 assertions | **12/12 classes, 70 assertions** |
| Dashboard | `npm run build --prefix apps/dashboard` | builds, all 8 routes emitted | builds; authenticated runtime route emitted |
| Contracts | `npm run contracts:compile` | AuditAnchor compiled, solc 0.8.36 | AuditAnchor compiled, solc 0.8.36, 263-byte deployable bytecode |

---

## Residual risk

**None outstanding from this audit.** The count is zero because the audit says zero,
not because anything was suppressed, ignored, or excluded.

Two honest caveats about what that figure means:

1. It reflects **published advisories as of 2026-08-19**. A clean audit is a statement
   about what is known today, not a guarantee about the code.
2. `pnpm audit` covers the npm dependency tree. It says nothing about the Solidity
   contract, the RPC endpoint, or the PostgreSQL deployment.

The overrides pin *minimums*, not exact versions, so routine `pnpm install` runs will
continue to pick up patch releases above the floor.
