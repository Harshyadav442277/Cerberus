/**
 * Design §5.2 — threshold vs actual for the control that fired.
 *
 * Built from the mandate pinned on the audit record (mandate_version) and the
 * proposed action. Scenario 2's persuasive moment is seeing
 * `per_transaction_max: 1.00` next to `proposed: 5.00` without narration.
 */

export interface ThresholdActual {
  control: string;
  threshold: string;
  actual: string;
}

interface MandateControls {
  spend_caps?: {
    per_transaction_max?: number;
    rolling_window?: { window?: string; max_total?: number };
  };
  counterparty_policy?: {
    mode?: string;
    allowlist?: string[];
    unknown_counterparty_disposition?: string;
  };
  time_window?: {
    allowed_hours_utc?: string[];
    allowed_days?: string[];
  };
  velocity?: { max_transactions_per_hour?: number };
  scope?: { action_types?: string[]; currencies?: string[] };
}

interface ActionPayload {
  counterparty: string;
  amount: number;
  currency: string;
}

export function thresholdVsActual(
  ruleTriggered: string | null,
  mandate: {
    scope?: { action_types?: string[]; currencies?: string[] };
    controls?: MandateControls;
  } | null,
  payload: ActionPayload | null,
): ThresholdActual | null {
  if (!ruleTriggered || !mandate || !payload) return null;
  const controls: MandateControls = mandate.controls ?? {};
  const scope = mandate.scope ?? {};

  switch (ruleTriggered) {
    case "spend_caps.per_transaction_max":
      return {
        control: "spend_caps.per_transaction_max",
        threshold: String(controls.spend_caps?.per_transaction_max ?? "—"),
        actual: `proposed ${payload.amount}`,
      };
    case "spend_caps.rolling_window":
      return {
        control: "spend_caps.rolling_window",
        threshold: `${controls.spend_caps?.rolling_window?.max_total ?? "—"} / ${controls.spend_caps?.rolling_window?.window ?? "24h"}`,
        actual: `proposed ${payload.amount} (would add to rolling total)`,
      };
    case "counterparty_policy":
      return {
        control: "counterparty_policy",
        threshold: `allowlist ${JSON.stringify(controls.counterparty_policy?.allowlist ?? [])}`,
        actual: payload.counterparty,
      };
    case "velocity.max_transactions_per_hour":
      return {
        control: "velocity.max_transactions_per_hour",
        threshold: String(controls.velocity?.max_transactions_per_hour ?? "—"),
        actual: "hourly settled count at or above cap",
      };
    case "time_window":
      return {
        control: "time_window",
        threshold: `${JSON.stringify(controls.time_window?.allowed_hours_utc ?? [])} ${JSON.stringify(controls.time_window?.allowed_days ?? [])}`,
        actual: "proposed_at outside allowed window",
      };
    case "scope.action_types":
      return {
        control: "scope.action_types",
        threshold: JSON.stringify(scope.action_types ?? []),
        actual: "action_type not in scope",
      };
    case "scope.currencies":
      return {
        control: "scope.currencies",
        threshold: JSON.stringify(scope.currencies ?? []),
        actual: payload.currency,
      };
    default:
      return {
        control: ruleTriggered,
        threshold: "—",
        actual: "—",
      };
  }
}
