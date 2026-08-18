import { getPool } from "./pool.js";
import { insertAgentIdentity, insertMandate } from "./repository.js";
import { SEED_AGENT, SEED_MANDATE } from "./seed-data.js";

/**
 * Clears transactional demo rows and re-upserts the seed agent + mandate.
 * Shared by the CLI and scripts/demo.ts so Phase 7 thrice-runs stay in-process.
 */
export async function resetDemoState(): Promise<{ agentId: string; mandateId: string }> {
  await getPool().query(
    `TRUNCATE TABLE human_approval, execution_authorization, payment_reservation,
                    audit_anchor, audit_log, proposed_action
       RESTART IDENTITY CASCADE`,
  );

  const walletAddress = process.env.EXECUTOR_WALLET_ADDRESS?.trim();
  let agent = SEED_AGENT;
  if (/^0x[0-9a-fA-F]{40}$/.test(walletAddress ?? "")) {
    agent = { ...SEED_AGENT, wallet_address: walletAddress! };
  }

  await insertAgentIdentity(agent);
  await insertMandate(SEED_MANDATE);

  return { agentId: agent.agent_id, mandateId: SEED_MANDATE.mandate_id };
}
