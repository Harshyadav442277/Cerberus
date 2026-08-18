import { randomBytes, randomUUID } from "node:crypto";
import { ProposedActionSchema, type ProposedAction } from "@safr/core";
import {
  getAddress,
  keccak256,
  stringToHex,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson } from "./canonical.js";
import {
  ExecutionAuthorizationSchema,
  SignedExecutionAuthorizationSchema,
  type ExecutionAuthorization,
  type SignedExecutionAuthorization,
} from "./schema.js";
import type { ExecutionTarget } from "./target.js";
import { isValidPrivateKey } from "./keys.js";

const DOMAIN = "CERBERUS_EXECUTION_AUTHORIZATION_V1";

export class AuthorizationError extends Error {
  constructor(
    public readonly code:
      | "FORGED_AUTHORIZATION"
      | "AUTHORIZATION_EXPIRED"
      | "AUTHORIZATION_REPLAY"
      | "PROPOSAL_MISMATCH"
      | "MANDATE_MISMATCH"
      | "RESERVATION_MISMATCH"
      | "CHAIN_MISMATCH"
      | "TOKEN_MISMATCH"
      | "AMOUNT_MISMATCH"
      | "PAYEE_MISMATCH"
      | "RESOURCE_MISMATCH",
  ) {
    super(code);
    this.name = "AuthorizationError";
  }
}

export interface AuthorizationUseStore {
  /** Atomic check-and-consume. False means either ID or nonce was already used. */
  consume(authorizationId: string, nonce: string): boolean;
}

export class InMemoryAuthorizationUseStore implements AuthorizationUseStore {
  private readonly ids = new Set<string>();
  private readonly nonces = new Set<string>();

  consume(authorizationId: string, nonce: string): boolean {
    if (this.ids.has(authorizationId) || this.nonces.has(nonce)) return false;
    this.ids.add(authorizationId);
    this.nonces.add(nonce);
    return true;
  }
}

export interface IssueAuthorizationInput {
  action: ProposedAction;
  mandateId: string;
  mandateVersion: number;
  reservationId: string;
  target: ExecutionTarget;
  authorizerPrivateKey: Hex;
  ttlSeconds?: number;
  nowMs?: number;
  authorizationId?: string;
  nonce?: Hex;
}

export function hashProposal(action: ProposedAction): `0x${string}` {
  const parsed = ProposedActionSchema.parse(action);
  return keccak256(stringToHex(canonicalJson(parsed)));
}

export function authorizationMessage(authorization: ExecutionAuthorization): string {
  return `${DOMAIN}\n${canonicalJson(ExecutionAuthorizationSchema.parse(authorization))}`;
}

export async function issueExecutionAuthorization(
  input: IssueAuthorizationInput,
): Promise<SignedExecutionAuthorization> {
  const nowMs = input.nowMs ?? Date.now();
  const ttlSeconds = input.ttlSeconds ?? 60;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 300) {
    throw new Error("authorization TTL must be between 1 and 300 seconds");
  }
  if (!isValidPrivateKey(input.authorizerPrivateKey)) {
    throw new Error("authorizer private key is not a valid secp256k1 scalar");
  }

  const authorization = ExecutionAuthorizationSchema.parse({
    authorizationId: input.authorizationId ?? `auth_${randomUUID()}`,
    proposalHash: hashProposal(input.action),
    mandateId: input.mandateId,
    mandateVersion: input.mandateVersion,
    reservationId: input.reservationId,
    chainId: input.target.chainId,
    token: getAddress(input.target.token),
    amount: input.target.amount,
    payTo: getAddress(input.target.payTo),
    resourceHash: input.target.resourceHash,
    expiresAt: Math.floor(nowMs / 1000) + ttlSeconds,
    nonce: input.nonce ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
  });

  const signer = privateKeyToAccount(input.authorizerPrivateKey);
  const signature = await signer.signMessage({ message: authorizationMessage(authorization) });
  return SignedExecutionAuthorizationSchema.parse({ authorization, signature });
}

export interface VerifyAuthorizationInput {
  envelope: SignedExecutionAuthorization;
  action: ProposedAction;
  target: ExecutionTarget;
  expectedAuthorizer: Address;
  expectedMandateId: string;
  expectedMandateVersion: number;
  expectedReservationId: string;
  useStore: AuthorizationUseStore;
  nowMs?: number;
}

function sameAddress(left: string, right: string): boolean {
  return getAddress(left) === getAddress(right);
}

export async function verifyAndConsumeExecutionAuthorization(
  input: VerifyAuthorizationInput,
): Promise<ExecutionAuthorization> {
  const envelope = SignedExecutionAuthorizationSchema.parse(input.envelope);
  const authorization = envelope.authorization;
  const validSignature = await verifyMessage({
    address: input.expectedAuthorizer,
    message: authorizationMessage(authorization),
    signature: envelope.signature as Hex,
  });
  if (!validSignature) throw new AuthorizationError("FORGED_AUTHORIZATION");

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (authorization.expiresAt <= nowSeconds) {
    throw new AuthorizationError("AUTHORIZATION_EXPIRED");
  }
  if (authorization.proposalHash !== hashProposal(input.action)) {
    throw new AuthorizationError("PROPOSAL_MISMATCH");
  }
  if (
    authorization.mandateId !== input.expectedMandateId ||
    authorization.mandateVersion !== input.expectedMandateVersion
  ) {
    throw new AuthorizationError("MANDATE_MISMATCH");
  }
  if (authorization.reservationId !== input.expectedReservationId) {
    throw new AuthorizationError("RESERVATION_MISMATCH");
  }
  if (authorization.chainId !== input.target.chainId) {
    throw new AuthorizationError("CHAIN_MISMATCH");
  }
  if (!sameAddress(authorization.token, input.target.token)) {
    throw new AuthorizationError("TOKEN_MISMATCH");
  }
  if (authorization.amount !== input.target.amount) {
    throw new AuthorizationError("AMOUNT_MISMATCH");
  }
  if (!sameAddress(authorization.payTo, input.target.payTo)) {
    throw new AuthorizationError("PAYEE_MISMATCH");
  }
  if (authorization.resourceHash !== input.target.resourceHash) {
    throw new AuthorizationError("RESOURCE_MISMATCH");
  }

  // This synchronous call is the one-shot boundary. The executor invokes it before
  // constructing the payer, so concurrent replays in one executor process cannot both win.
  if (!input.useStore.consume(authorization.authorizationId, authorization.nonce)) {
    throw new AuthorizationError("AUTHORIZATION_REPLAY");
  }
  return authorization;
}
