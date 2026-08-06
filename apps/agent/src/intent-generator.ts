import { randomUUID } from "node:crypto";
import { ProposedActionSchema, type ProposedAction } from "@safr/core";

/**
 * Turns a scenario description into a Bible Section 7.3 Proposed Action.
 *
 * The LLM's ONLY job is to produce structured payment intents (Bible Section 8). It
 * has no view on whether a payment is permitted, it never sees a mandate, and its
 * output is validated against the Section 7.3 schema before it goes anywhere near the
 * Disposition Engine. Compliance logic is rule-based and lives entirely in the engine
 * (Bible Section 0.6, Rules R3).
 *
 * Two modes:
 *   - `llm`      when ANTHROPIC_API_KEY is set
 *   - `fixture`  otherwise — the descope-ladder fallback for blocker B2
 *
 * The two modes are interchangeable because both are validated against the same
 * schema, so the rest of the system cannot tell which produced an action.
 */

export interface Scenario {
  /** Bible Section 9 scenario label, used for CLI output. */
  name: string;
  /** Natural-language brief handed to the LLM. */
  brief: string;
  /** The intent the fixture mode produces, and what the LLM is steered toward. */
  intent: {
    counterparty: string;
    amount: number;
    currency: string;
    purpose: string;
    reference: string;
  };
}

/** The three scenarios from Bible Section 9, with the confirmed faucet-sized amounts. */
export const SCENARIOS: Record<string, Scenario> = {
  clean: {
    name: "Scenario 1 — clean transaction",
    brief:
      "Pay the recurring invoice from our regular supplier merchant_xyz. " +
      "Invoice 884 is for 0.50 USDC for service fulfillment.",
    intent: {
      counterparty: "merchant_xyz",
      amount: 0.5,
      currency: "USDC",
      purpose: "service_fulfillment",
      reference: "invoice_884",
    },
  },
  cap_breach: {
    name: "Scenario 2 — cap breach",
    brief:
      "Settle the large outstanding balance with merchant_abc. " +
      "Invoice 885 is for 5.00 USDC for service fulfillment.",
    intent: {
      counterparty: "merchant_abc",
      amount: 5.0,
      currency: "USDC",
      purpose: "service_fulfillment",
      reference: "invoice_885",
    },
  },
  new_counterparty: {
    name: "Scenario 3 — new counterparty",
    brief:
      "Pay merchant_new, a supplier we have not used before. " +
      "Invoice 886 is for 0.75 USDC for service fulfillment.",
    intent: {
      counterparty: "merchant_new",
      amount: 0.75,
      currency: "USDC",
      purpose: "service_fulfillment",
      reference: "invoice_886",
    },
  },
};

export interface IntentGenerator {
  mode: "llm" | "fixture";
  propose(scenario: Scenario, agentId: string): Promise<ProposedAction>;
}

function newActionId(): string {
  return `action_${randomUUID().slice(0, 8)}`;
}

export function createFixtureIntentGenerator(): IntentGenerator {
  return {
    mode: "fixture",
    async propose(scenario, agentId) {
      return ProposedActionSchema.parse({
        action_id: newActionId(),
        agent_id: agentId,
        action_type: "payment",
        proposed_at: new Date().toISOString(),
        payload: scenario.intent,
      });
    },
  };
}

const SYSTEM_PROMPT = [
  "You are the payments module of a corporate treasury agent.",
  "Convert the user's instruction into a single JSON payment intent.",
  "",
  'Reply with ONLY a JSON object, no prose and no code fence, of exactly this shape:',
  '{"counterparty": string, "amount": number, "currency": string, "purpose": string, "reference": string}',
  "",
  "Do not judge whether the payment is allowed, within policy, or advisable.",
  "You do not enforce limits. Report the instruction faithfully as structured data.",
].join("\n");

/**
 * Anthropic Messages API over plain `fetch`.
 *
 * No SDK dependency: this is one HTTP POST, and the approved stack is closed
 * (Rules R2). Adding a package for a single request would be added risk, not saved
 * time.
 */
async function callAnthropic(apiKey: string, model: string, brief: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: brief }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = body.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Anthropic API returned no text block");
  return text;
}

/** Tolerates a ```json fence even though the prompt forbids one. */
function parseIntentJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export function createLlmIntentGenerator(apiKey: string, model: string): IntentGenerator {
  return {
    mode: "llm",
    async propose(scenario, agentId) {
      const raw = await callAnthropic(apiKey, model, scenario.brief);
      // Validated against Section 7.3 before it can reach the engine. A malformed or
      // hallucinated intent fails loudly here rather than becoming a strange
      // disposition further down.
      return ProposedActionSchema.parse({
        action_id: newActionId(),
        agent_id: agentId,
        action_type: "payment",
        proposed_at: new Date().toISOString(),
        payload: parseIntentJson(raw),
      });
    },
  };
}

/** LLM when a key is available, fixtures otherwise. */
export function createIntentGenerator(env: NodeJS.ProcessEnv = process.env): IntentGenerator {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return createFixtureIntentGenerator();
  return createLlmIntentGenerator(apiKey, env.LLM_MODEL ?? "claude-sonnet-4-20250514");
}
