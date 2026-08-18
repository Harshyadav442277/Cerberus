import type { Mandate } from "@safr/core";
import { getPool } from "../pool.js";
import {
  insertAgentIdentity,
  insertAuditLogRecord,
  insertMandate,
  insertProposedAction,
} from "../repository.js";
import type { ReserveBudgetInput } from "../reservations.js";

/**
 * Fixtures for the Phase 2 concurrency suite.
 *
 * These tests need a REAL PostgreSQL, because the property under test is a database
 * property: a transaction-scoped lock plus a NUMERIC capacity check. Faking the
 * database here would test nothing that matters — an in-memory stub would serialise
 * by construction and every concurrency assertion would pass vacuously.
 */

export const USDC = "USDC";
export const CHAIN_ID = 84532;
export const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const AT = "2026-08-18T12:00:00.000Z";

/** Decimal to 6-dp atomic units, via BigInt so no float rounding enters the money path. */
export function atomic(amount: number): string {
  return (BigInt(Math.round(amount * 1_000_000)) * 1n).toString();
}

/** node-postgres default pool size. Warming beyond it would just queue. */
const POOL_MAX = 10;

/**
 * Runs `count` operations that genuinely overlap inside the database.
 *
 * Two things are required for a real race, and both were confirmed by deleting the
 * advisory lock and watching which tests still passed:
 *
 *  - the pool must ALREADY hold established connections. Otherwise the first caller
 *    completes its whole transaction while the second is still finishing a TCP and
 *    auth handshake, and the "concurrent" test is quietly sequential.
 *  - every caller must be released from one barrier, so none of them gets a head
 *    start from being scheduled first.
 */
export async function race<T>(count: number, run: (index: number) => Promise<T>): Promise<T[]> {
  const warm = await Promise.all(
    Array.from({ length: Math.min(count, POOL_MAX) }, () => getPool().connect()),
  );
  for (const client of warm) client.release();

  let start!: () => void;
  const barrier = new Promise<void>((resolve) => {
    start = resolve;
  });
  const running = Array.from({ length: count }, (_, index) => barrier.then(() => run(index)));
  start();
  return Promise.all(running);
}

export async function resetFixtures(): Promise<void> {
  await getPool().query(
    `TRUNCATE TABLE payment_reservation, audit_anchor, audit_log, proposed_action,
                    mandate, agent_identity
     RESTART IDENTITY CASCADE`,
  );
}

export async function seedAgent(agentId: string): Promise<void> {
  await insertAgentIdentity({
    agent_id: agentId,
    display_name: agentId,
    owner_org: "acme_corp",
    created_at: "2026-08-01T00:00:00.000Z",
    wallet_address: "0x0000000000000000000000000000000000000000",
    status: "active",
  });
}

export function mandateFixture(options: {
  mandateId: string;
  agentId: string;
  version?: number;
  maxTotal: number;
  window?: string;
  perTransactionMax?: number;
}): Mandate {
  return {
    mandate_id: options.mandateId,
    agent_id: options.agentId,
    version: options.version ?? 1,
    effective_from: "2026-08-01T00:00:00.000Z",
    effective_to: null,
    status: "active",
    scope: { action_types: ["payment"], currencies: [USDC] },
    controls: {
      spend_caps: {
        per_transaction_max: options.perTransactionMax ?? options.maxTotal,
        rolling_window: { window: options.window ?? "24h", max_total: options.maxTotal },
      },
      counterparty_policy: {
        mode: "allowlist",
        allowlist: ["merchant_xyz"],
        unknown_counterparty_disposition: "ESCALATE",
      },
      time_window: {
        allowed_hours_utc: ["00:00-23:59"],
        allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      },
      velocity: { max_transactions_per_hour: 1000 },
    },
    default_disposition_on_breach: "DENY",
    created_by: "compliance_officer_01",
    approved_by: "compliance_officer_01",
  };
}

export interface SeededProposal {
  auditId: string;
  actionId: string;
  agentId: string;
  mandateId: string;
  mandateVersion: number;
  amount: number;
}

/** One proposal that already reached an ALLOW audit record, ready to reserve against. */
export async function seedProposal(options: {
  id: string;
  agentId: string;
  mandateId: string;
  mandateVersion?: number;
  amount: number;
}): Promise<SeededProposal> {
  const actionId = `action_${options.id}`;
  const auditId = `audit_${options.id}`;
  const mandateVersion = options.mandateVersion ?? 1;

  await insertProposedAction({
    action_id: actionId,
    agent_id: options.agentId,
    action_type: "payment",
    proposed_at: AT,
    payload: {
      counterparty: "merchant_xyz",
      amount: options.amount,
      currency: USDC,
      purpose: "service_fulfillment",
      reference: `invoice_${options.id}`,
    },
  });
  await insertAuditLogRecord({
    audit_id: auditId,
    action_id: actionId,
    agent_id: options.agentId,
    mandate_id: options.mandateId,
    mandate_version: mandateVersion,
    disposition: "ALLOW",
    reason: "within_mandate",
    rule_triggered: null,
    evaluated_at: AT,
    human_review: null,
    settlement: null,
  });

  return {
    auditId,
    actionId,
    agentId: options.agentId,
    mandateId: options.mandateId,
    mandateVersion,
    amount: options.amount,
  };
}

export function reserveInput(
  proposal: SeededProposal,
  maxTotal: number,
  overrides: Partial<ReserveBudgetInput> = {},
): ReserveBudgetInput {
  return {
    auditId: proposal.auditId,
    actionId: proposal.actionId,
    agentId: proposal.agentId,
    mandateId: proposal.mandateId,
    mandateVersion: proposal.mandateVersion,
    currency: USDC,
    amountDecimal: proposal.amount.toString(),
    amountAtomic: atomic(proposal.amount),
    chainId: CHAIN_ID,
    token: TOKEN,
    maxTotal: maxTotal.toString(),
    rollingWindow: "24h",
    velocityLimit: 1000,
    velocityOverrideApproved: false,
    at: AT,
    ...overrides,
  };
}

export { insertMandate };
