# Cerberus finalist security critique and hardening specification

**Status:** approved Stage 2 security-depth amendment, 18 August 2026.

**Source:** distilled from the project owner's `cerberus_cheatsheet_UPDATED.md` and
the attached finalist implementation prompt. The private competitive analysis is not
copied into the public repository; the engineering requirements are preserved here.

**Relationship to the Bible:** `SAFR_RUNTIME_PROJECT_BIBLE.md` remains authoritative
for product direction, SAFR terminology, frozen Section 7 schemas, deterministic rule
order, and the Base Sepolia USDC/x402 rail. This document supersedes only the old
Stage-1 decisions to defer signer isolation, concurrent budget safety, replay/stale
state protection, exact execution binding, and ambiguous-settlement handling.

## Finalist objective

Cerberus must be the strongest possible answer to:

> What happens if the AI itself becomes malicious or compromised?

Depth of authority enforcement wins; breadth does not. Do not add payment rails,
live settlement currencies, FX, checkout features, credit, unrelated UI work,
unrelated refactors, or unnecessary AI behavior.

## Required execution path

```text
AI/runtime
    -> deterministic Cerberus Disposition Engine
    -> ALLOW or approved ESCALATE
    -> atomic budget reservation
    -> one-shot signed Execution Authorization
    -> isolated executor holding the payment key
    -> exact x402 challenge validation
    -> settlement
```

The agent/application process must never receive the x402 payment private key.

## Build order

Complete one phase at a time. Each phase must pass existing tests, new adversarial
tests, typecheck, and the dashboard production build before the next starts.

1. Signer isolation and Execution Authorization.
2. Atomic budget reservations.
3. Replay, stale mandate, and stale human-approval protection.
4. Exact x402 challenge binding.
5. `OUTCOME_UNKNOWN` settlement reconciliation.
6. Complete adversarial suite.
7. Seeded judge-facing scalability/adversarial sandbox.
8. Demo hardening and feature freeze.

## Execution Authorization contract

Every signed authorization binds at minimum:

- `authorizationId`
- `proposalHash`
- `mandateId`
- `mandateVersion`
- `reservationId`
- `chainId`
- exact token contract
- exact atomic amount
- exact `payTo`
- exact resource/challenge hash
- expiry
- nonce

The executor independently verifies the signature, expiry, one-shot state, proposal,
mandate context, reservation context, chain, token, amount, payee, and resource before
the payer/signer is constructed.

## Financial state

```text
RESERVED -> AUTHORIZED -> SUBMITTING -> SETTLED | FAILED | OUTCOME_UNKNOWN
```

- `FAILED` means execution is positively known not to have happened; release safely.
- `OUTCOME_UNKNOWN` means execution may have happened; never retry blindly.
- Do not hold a database transaction open during network or chain settlement.

## Required adversarial evidence

- DENY never reaches the authorizer, executor, or x402.
- Compromised agent process has no payment key or x402 payer import.
- Forged, expired, and replayed authorizations are refused before key use.
- Mutated proposal, payee, amount, token, chain, and resource are refused.
- Concurrent requests, including different agents sharing a mandate, cannot overspend.
- Stale mandate and stale human approval are refused.
- Duplicate proposal creates one financial effect.
- Lost response after broadcast becomes `OUTCOME_UNKNOWN` and is reconciled before retry.
- Positively known failure releases its reservation.

## Current Phase 1 boundary

Phase 1 introduces a trusted API/control-plane authorizer and an isolated executor.
It deliberately does **not** claim atomic reservation, durable replay state, current
mandate/review freshness, exact live 402-challenge inspection, or ambiguous-settlement
reconciliation. Those claims become valid only after phases 2–5 respectively.
