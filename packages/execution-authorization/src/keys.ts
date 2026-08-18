const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** Validates a secp256k1 private scalar without constructing or exposing a signer. */
export function isValidPrivateKey(value: string): value is `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return false;
  const scalar = BigInt(value);
  return scalar > 0n && scalar < SECP256K1_ORDER;
}
