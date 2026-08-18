import { reviewerEnv } from "./env.js";

type Decision = "approved" | "denied";
interface PendingEscalation {
  action: { action_id: string };
  record: { mandate_version: number };
}

const args = process.argv.slice(2);
const decisionArg = args.find((arg) => arg.startsWith("--decision="))?.split("=")[1];
const decision: Decision = decisionArg === "denied" ? "denied" : "approved";
const countArg = Number(args.find((arg) => arg.startsWith("--count="))?.split("=")[1] ?? "1");
const count = Number.isInteger(countArg) && countArg > 0 ? countArg : 1;
const note =
  args.find((arg) => arg.startsWith("--note="))?.slice("--note=".length) ??
  "Pre-staged decision from the trusted reviewer control plane.";

async function pending(): Promise<PendingEscalation[]> {
  const response = await fetch(`${reviewerEnv.apiBaseUrl}/escalations`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`pending escalations request failed (${response.status})`);
  const body = (await response.json()) as { items?: PendingEscalation[] };
  return Array.isArray(body.items) ? body.items : [];
}

async function decide(item: PendingEscalation): Promise<void> {
  const response = await fetch(
    `${reviewerEnv.apiBaseUrl}/escalations/${encodeURIComponent(item.action.action_id)}/decision`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${reviewerEnv.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        decision,
        note,
        mandate_version: item.record.mandate_version,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `review decision failed (${response.status})`);
  }
  console.log(`${decision} ${item.action.action_id} through authenticated reviewer control plane`);
}

async function main(): Promise<void> {
  if (reviewerEnv.token.length < 32) {
    throw new Error(
      "REVIEWER_API_TOKEN must be at least 32 characters in .env.reviewer or the reviewer process env",
    );
  }

  for (let completed = 0; completed < count; completed += 1) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const [item] = await pending();
      if (item) {
        await decide(item);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (Date.now() >= deadline) throw new Error("timed out waiting for an escalation");
  }
}

try {
  await main();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
