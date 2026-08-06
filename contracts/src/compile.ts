import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import solc from "solc";

export const CONTRACT_NAME = "AuditAnchor";
export const CONTRACT_PATH = resolve(import.meta.dirname, "../AuditAnchor.sol");

export interface CompiledContract {
  abi: readonly unknown[];
  bytecode: `0x${string}`;
}

interface SolcOutput {
  errors?: Array<{ severity: string; formattedMessage: string }>;
  contracts?: Record<
    string,
    Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>
  >;
}

/** Compiles AuditAnchor.sol in memory. No artifacts are required on disk. */
export function compileAuditAnchor(): CompiledContract {
  const source = readFileSync(CONTRACT_PATH, "utf8");

  const input = {
    language: "Solidity",
    sources: { [`${CONTRACT_NAME}.sol`]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;

  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Solidity compilation failed:\n${errors.map((e) => e.formattedMessage).join("\n")}`);
  }

  const contract = output.contracts?.[`${CONTRACT_NAME}.sol`]?.[CONTRACT_NAME];
  if (!contract) throw new Error(`Compiler produced no ${CONTRACT_NAME} contract`);

  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

if (import.meta.filename === process.argv[1]) {
  const { abi, bytecode } = compileAuditAnchor();
  console.log(`\n  ${CONTRACT_NAME} compiled with solc ${solc.version()}`);
  console.log(`  abi entries    ${abi.length}`);
  console.log(`  bytecode size  ${(bytecode.length - 2) / 2} bytes\n`);
}
