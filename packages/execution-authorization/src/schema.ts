import { z } from "zod";

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const atomicAmount = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => BigInt(value) > 0n, "amount must be positive");

/**
 * Finalist hardening primitive. Kept separate from the frozen Bible Section 7
 * schemas: this is an execution capability, not a SAFR mandate/audit field.
 */
export const ExecutionAuthorizationSchema = z
  .object({
    authorizationId: z.string().min(1).max(160),
    proposalHash: bytes32,
    mandateId: z.string().min(1).max(160),
    mandateVersion: z.number().int().positive(),
    reservationId: z.string().min(1).max(200),
    chainId: z.number().int().positive(),
    token: address,
    amount: atomicAmount,
    payTo: address,
    resourceHash: bytes32,
    expiresAt: z.number().int().positive(),
    nonce: bytes32,
  })
  .strict();

export const SignedExecutionAuthorizationSchema = z
  .object({
    authorization: ExecutionAuthorizationSchema,
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();

export type ExecutionAuthorization = z.infer<typeof ExecutionAuthorizationSchema>;
export type SignedExecutionAuthorization = z.infer<typeof SignedExecutionAuthorizationSchema>;
