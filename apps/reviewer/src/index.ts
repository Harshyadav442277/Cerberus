import { reviewerEnv } from "./env.js";
import { createReviewerApiClient, type Decision } from "./client.js";

const args = process.argv.slice(2);
const decisionArg = args.find((arg) => arg.startsWith("--decision="))?.split("=")[1];
const decision: Decision = decisionArg === "denied" ? "denied" : "approved";
const countArg = Number(args.find((arg) => arg.startsWith("--count="))?.split("=")[1] ?? "1");
const count = Number.isInteger(countArg) && countArg > 0 ? countArg : 1;
const note =
  args.find((arg) => arg.startsWith("--note="))?.slice("--note=".length) ??
  "Pre-staged decision from the trusted reviewer control plane.";

async function main(): Promise<void> {
  if (reviewerEnv.token.length < 32) {
    throw new Error(
      "REVIEWER_API_TOKEN must be at least 32 characters in .env.reviewer or the reviewer process env",
    );
  }

  const api = createReviewerApiClient({
    apiBaseUrl: reviewerEnv.apiBaseUrl,
    token: reviewerEnv.token,
  });

  for (let completed = 0; completed < count; completed += 1) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const [item] = await api.pending();
      if (item) {
        await api.decide(item, decision, note);
        console.log(`${decision} ${item.action.action_id} through authenticated reviewer control plane`);
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
