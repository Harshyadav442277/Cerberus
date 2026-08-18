/**
 * Migration CLI.
 *
 *   pnpm --filter @safr/db migrate          apply pending migrations
 *   pnpm --filter @safr/db migrate:down     roll back the most recent migration
 *   pnpm --filter @safr/db migrate:status    show applied vs pending
 */
import { appliedMigrations, listMigrations, migrateDown, migrateUp } from "../migrator.js";
import { closePool, getDatabaseUrl } from "../pool.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  console.log(`\n[db] ${getDatabaseUrl().replace(/:\/\/[^@]*@/, "://***@")}\n`);

  switch (command) {
    case "up": {
      const done = await migrateUp();
      if (done.length === 0) {
        console.log("  no pending migrations");
      } else {
        for (const id of done) console.log(`  applied  ${id}`);
      }
      break;
    }
    case "down": {
      const rolled = await migrateDown();
      console.log(rolled ? `  rolled back  ${rolled}` : "  nothing to roll back");
      break;
    }
    case "status": {
      const applied = new Set(await appliedMigrations());
      for (const m of await listMigrations()) {
        console.log(`  ${applied.has(m.id) ? "applied" : "pending"}  ${m.id}`);
      }
      break;
    }
    default:
      console.error(`  unknown command '${command}' (expected up | down | status)`);
      process.exitCode = 1;
  }
  console.log("");
}

try {
  await main();
} catch (error) {
  console.error(`\n  ERROR ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}
