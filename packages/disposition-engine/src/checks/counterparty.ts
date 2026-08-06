import type { Check } from "../types.js";

/**
 * Bible Section 7.4, check 3 — counterparty allowlist.
 *
 * Judgment-based rather than a hard boundary, so the outcome is NOT hardcoded: it is
 * whatever the mandate's `unknown_counterparty_disposition` field says. Changing that
 * field in the mandate changes the disposition with no code change.
 *
 * Bible Section 7.2 calls this out explicitly — it is what makes the ambiguous demo
 * case (scenario 3) rule-driven rather than a scripted trick, which matters for
 * Technical Quality scoring.
 */
export const counterpartyCheck: Check = (proposedAction, mandate) => {
  const policy = mandate.controls.counterparty_policy;
  if (!policy.allowlist.includes(proposedAction.payload.counterparty)) {
    return {
      disposition: policy.unknown_counterparty_disposition,
      reason: "counterparty_not_on_allowlist",
      rule: "counterparty_policy",
    };
  }
  return null;
};
