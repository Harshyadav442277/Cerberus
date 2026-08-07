import { privateKeyToAccount } from "viem/accounts";
import { getPool } from "./pool.js";
import { insertAgentIdentity, insertMandate } from "./repository.js";
import { SEED_AGENT, SEED_MANDATE } from "./seed-data.js";

/**
 * Clears transactional demo rows and re-upserts the seed agent + mandate.
 * Shared by the CLI and scripts/demo.ts so Phase 7 thrice-runs stay in-process.
 */
export async function resetDemoState(): Promise<{ agentId: string; mandateId: string }> {
  await getPool().query(
    `TRUNCATE TABLE audit_anchor, audit_log, proposed_action RESTART IDENTITY CASCADE`,
  );

  const key = process.env.EVM_PRIVATE_KEY?.trim();
  let agent = SEED_AGENT;
  if (key) {
    try {
      agent = {
        ...SEED_AGENT,
        wallet_address: privateKeyToAccount(key as `0x${string}`).address,
      };
    } catch {
      // keep seed wallet
    }
  }

  await insertAgentIdentity(agent);
  await insertMandate(SEED_MANDATE);

  return { agentId: agent.agent_id, mandateId: SEED_MANDATE.mandate_id };
}
