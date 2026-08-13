/**
 * Generates a fresh, dedicated testnet keypair for the payer (the agent's wallet)
 * and an address for the payee (the merchant's receiver).
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

  const payeePrivateKey = generatePrivateKey();
  const payee = privateKeyToAccount(payeePrivateKey);

  console.log("\nFresh Base Sepolia testnet wallets — testnet use only.\n");
  console.log("Paste into .env at the repo root:\n");
  console.log(`EVM_PRIVATE_KEY=${payerPrivateKey}`);
  console.log(`EVM_ADDRESS=${payee.address}`);
  console.log("\nDetail:\n");
  console.log(`  payer (agent)     ${payer.address}`);
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
