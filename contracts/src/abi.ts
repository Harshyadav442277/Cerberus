/**
 * AuditAnchor's ABI, hand-written so consumers need no build step and no generated
 * artifact on disk.
 *
 * A test in packages/audit-log compiles AuditAnchor.sol and asserts the compiler's
 * ABI matches this one, so the two cannot drift apart silently.
 */
export const AUDIT_ANCHOR_ABI = [
  {
    type: "event",
    name: "Anchored",
    inputs: [
      { name: "recordHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "submitter", type: "address", indexed: true, internalType: "address" },
      { name: "blockTime", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "anchor",
    inputs: [{ name: "recordHash", type: "bytes32", internalType: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "anchorCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
