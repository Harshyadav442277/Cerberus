/**
 * Child process for the durability test.
 *
 * Reserves capacity and then dies HARD — `process.exit` with no unwinding, no
 * `closePool`, no chance to release anything — at exactly the point the build order
 * calls out: after the reservation, before an authorization exists. The parent test
 * then asserts from a different process that the capacity is still held.
 */
import { reserveBudget } from "../reservations.js";

const input = JSON.parse(process.argv[2] ?? "{}");
const result = await reserveBudget(input);
process.stdout.write(`${JSON.stringify(result)}\n`);

// Not closePool(), not process.exitCode. A real crash.
process.exit(9);
