export const JUDGE_EVIDENCE = {
  capturedAt: "22 AUG 2026",
  githubRoot:
    "https://github.com/Harshyadav442277/Cerberus/blob/main/artifacts/judge-evidence",
  finalRoot:
    "https://github.com/Harshyadav442277/Cerberus/blob/main/artifacts/final-evidence",
  contracts: {
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    auditAnchor: "0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7",
  },
  identities: {
    payer: "0x35820e5cC60F961515EF987C94D4328a82Df38Fc",
    payee: "0xf56e3F3134879156e11EAff78978a270726B661b",
  },
  deny: {
    auditId: "audit_84670a33",
    anchorTx: "0xfaabd09ea1829938d7d447b9aa1152743cd2eae62738873b22366eb631e9a7aa",
    evidencePath: "04_deny/deny-summary-final.log",
  },
  escalate: {
    auditId: "audit_30aa1a70",
    settlementTx: "0x55ba3c22d58a83a1b6093f2e289c544239d4839cd97b008b791d5a6052225469",
    anchorTx: "0x3d4659c3890b2061eaf04fc4351b83bce5d496c999259e6a8a55a6290be78877",
    evidencePath: "05_escalate/escalate-final.log",
  },
  allow: {
    auditId: "audit_ff45a977",
    settlementTx: "0xfe4d02288ea8882d8b75e520cf627e97d57b04e4f3a3cc81e40b780a36c995fa",
    anchorTx: "0xdb4eed29be7f44d0c7af7375721047219cf6c74c0f87a08b373938a6b9596368",
    evidencePath: "06_allow/allow-final.log",
  },
  unknown: {
    auditId: "audit_0aaac796",
    authorizationId: "auth_4920d58f-1337-4d44-ba7a-70b3f0fdff9a",
    reservationId: "res_bcaf9720-4b9a-4710-946c-cb9d00d04a36",
    payer: "0x35820e5cC60F961515EF987C94D4328a82Df38Fc",
    nonce: "0x8dbcbebfc0c876c91a6b64f0e716f5b52f09257901583d7692b38d06dc9739dc",
    validBefore: 1787359784,
    anchorTx: "0x156f3ed3e17d65a59ca37593befa8eb47b02dae8b44eafbe5b008318db8d62e3",
    evidencePath: "07_unknown/unknown-reconciliation-final.log",
  },
  anchors: [
    ["audit_03117a66", "0x98b34f10e47aac9e2e46b18ee4e049500866cd83af0743e43a8f6a3189ede2da"],
    ["audit_84670a33", "0xfaabd09ea1829938d7d447b9aa1152743cd2eae62738873b22366eb631e9a7aa"],
    ["audit_30aa1a70", "0x3d4659c3890b2061eaf04fc4351b83bce5d496c999259e6a8a55a6290be78877"],
    ["audit_0aaac796", "0x156f3ed3e17d65a59ca37593befa8eb47b02dae8b44eafbe5b008318db8d62e3"],
    ["audit_ff45a977", "0xdb4eed29be7f44d0c7af7375721047219cf6c74c0f87a08b373938a6b9596368"],
  ] as const,
} as const;

export function baseScanTx(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

export function evidenceLink(path: string): string {
  return `${JUDGE_EVIDENCE.githubRoot}/${path}`;
}
