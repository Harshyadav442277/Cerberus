/**
 * Generates separate testnet payment, authorization, audit-anchor, and merchant
 * identities. Each private key is printed with the one env file that may hold it.
 *
 * These keys are for Base Sepolia only. Never point .env at a wallet that holds
 * real assets — the payer key is read by the settlement path and signs transfers.
 *
 * Run: pnpm wallets:new
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function main(): void {
  const payerPrivateKey = generatePrivateKey();
  const payer = privateKeyToAccount(payerPrivateKey);

  const authorizerPrivateKey = generatePrivateKey();
  const authorizer = privateKeyToAccount(authorizerPrivateKey);

  const anchorPrivateKey = generatePrivateKey();
  const anchor = privateKeyToAccount(anchorPrivateKey);

  const payeePrivateKey = generatePrivateKey();
  const payee = privateKeyToAccount(payeePrivateKey);

  console.log("\nFresh Base Sepolia testnet wallets — testnet use only.\n");
  console.log("Paste into .env.executor (executor process only):\n");
  console.log(`EXECUTOR_EVM_PRIVATE_KEY=${payerPrivateKey}`);
  console.log("\nPaste into .env.authorizer (API/control-plane process only):\n");
  console.log(`EXECUTION_AUTH_PRIVATE_KEY=${authorizerPrivateKey}`);
  console.log("\nPaste into .env.anchor (trusted anchor worker only):\n");
  console.log(`AUDIT_ANCHOR_PRIVATE_KEY=${anchorPrivateKey}`);
  console.log("\nEach key belongs to exactly one file. Never copy any of them into .env.agent —");
  console.log("the agent process holds no signer at all.");
  console.log("\nPaste these public values into .env:\n");
  console.log(`EVM_ADDRESS=${payee.address}`);
  console.log(`EXECUTION_AUTHORIZER_ADDRESS=${authorizer.address}`);
  console.log(`EXECUTOR_WALLET_ADDRESS=${payer.address}`);
  console.log("\nDetail:\n");
  console.log(`  payer (executor)  ${payer.address}`);
  console.log(`  authorizer        ${authorizer.address}`);
  console.log(`  anchor signer     ${anchor.address}`);
  console.log(`  payee (merchant)  ${payee.address}`);
  console.log(`  payee private key ${payeePrivateKey}`);
  console.log(
    "\nThe payee key is not needed to run the demo — keep it only if you want to\n" +
      "move the received test USDC back out afterwards.\n",
  );
  console.log("Fund the payer address before running phase1:preflight:");
  console.log(`  Base Sepolia ETH   https://www.alchemy.com/faucets/base-sepolia`);
  console.log(`  Base Sepolia USDC  https://faucet.circle.com  (select Base Sepolia)\n`);
}

main();
