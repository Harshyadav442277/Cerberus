import type { Check } from "../types.js";

/**
 * Bible Section 7.4, check 1 — action type is a hard boundary.
 */
export const scopeActionTypeCheck: Check = (proposedAction, mandate) => {
  if (!mandate.scope.action_types.includes(proposedAction.action_type)) {
    return {
      disposition: "DENY",
      reason: "action_type_out_of_scope",
      rule: "scope.action_types",
    };
  }
  return null;
};

/**
 * Bible Section 7.4, check 1b — currency is a hard boundary.
 *
 * Bible Section 7.4 flags this as a correction that must not be reverted: an earlier
 * draft defined `scope.currencies` but never validated against it. Harmless for a
 * hardcoded-USDC demo, but it would read as an incompletely-enforced schema to
 * anyone reviewing the code. Do not remove this as redundant.
 */
export const scopeCurrencyCheck: Check = (proposedAction, mandate) => {
  if (!mandate.scope.currencies.includes(proposedAction.payload.currency)) {
    return {
      disposition: "DENY",
      reason: "currency_out_of_scope",
      rule: "scope.currencies",
    };
  }
  return null;
};
