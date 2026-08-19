import { ok, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import { ProposedActionPayloadSchema } from "@safr/core";
import {
  atomicUnitsToDecimal,
  decimalToAtomicUnits,
  exactDecimalString,
} from "../target.js";

/**
 * D5 — money boundaries.
 *
 * The failure this suite exists to prevent is silent rounding. A payment system that
 * quietly turns 0.0000001 into 0, or 1e-7 into the string "1e-7" in a NUMERIC column,
 * has not refused anything — it has agreed to something nobody proposed.
 *
 * The rule enforced throughout: money is converted through BigInt, and anything that
 * cannot be represented exactly is REFUSED rather than approximated. Guessing is
 * worse than failing, because a guess produces a payment.
 */

describe("money boundaries", () => {
  describe("amounts that must be refused outright", () => {
    const refused: Array<[string, number]> = [
      ["zero", 0],
      ["negative", -1],
      ["negative fraction", -0.000001],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
    ];

    for (const [label, amount] of refused) {
      it(`refuses ${label} rather than converting it`, () => {
        throws(() => decimalToAtomicUnits(amount), `${label} must not convert`);
        throws(() => exactDecimalString(amount), `${label} must not become decimal text`);
      });
    }

    it("refuses more precision than USDC can represent", () => {
      // 0.0000001 is a seventh decimal place. Rounding it to 0.000000 would be a
      // payment of nothing; rounding up would be a payment nobody authorised. It is
      // refused via the exponential guard, because JavaScript stringifies it "1e-7".
      throws(() => decimalToAtomicUnits(0.0000001), /exponential/);
      throws(() => decimalToAtomicUnits(1.1234567), /decimal places/);
    });

    it("refuses exponential notation instead of normalising it", () => {
      // JavaScript stringifies small numbers exponentially, and "1e-7" written into a
      // NUMERIC column as text is a silent corruption. Both directions refuse.
      strictEqual((1e-7).toString(), "1e-7", "the hazard is real, not hypothetical");
      throws(() => decimalToAtomicUnits(1e-7), /exponential|decimal places/);
      throws(() => exactDecimalString(1e-7), /exponential/);
      throws(() => exactDecimalString(1e21), /exponential/);
    });
  });

  describe("amounts that must convert exactly", () => {
    it("converts the smallest representable unit", () => {
      strictEqual(decimalToAtomicUnits(0.000001), "1");
      strictEqual(atomicUnitsToDecimal("1"), "0.000001");
    });

    it("converts whole and fractional amounts without float drift", () => {
      strictEqual(decimalToAtomicUnits(1), "1000000");
      strictEqual(decimalToAtomicUnits(0.5), "500000");
      strictEqual(decimalToAtomicUnits(5), "5000000");
      // 0.1 + 0.2 famously is not 0.3 in binary floating point. The conversion path
      // must not inherit that, because it runs through BigInt rather than arithmetic.
      strictEqual(decimalToAtomicUnits(0.3), "300000");
      strictEqual(decimalToAtomicUnits(1.000001), "1000001");
    });

    it("round-trips every boundary amount exactly", () => {
      for (const amount of [0.000001, 0.999999, 1, 1.000001, 5, 12.345678, 1000]) {
        const atomic = decimalToAtomicUnits(amount);
        const back = atomicUnitsToDecimal(atomic);
        strictEqual(
          Number(back),
          amount,
          `${amount} must survive decimal -> atomic -> decimal unchanged`,
        );
      }
    });

    it("keeps a large amount exact rather than approximating it", () => {
      // Well inside float integer precision, but the point is that the result is
      // computed with BigInt and is exact to the last atomic unit.
      strictEqual(decimalToAtomicUnits(1_000_000), "1000000000000");
      strictEqual(atomicUnitsToDecimal("1000000000000"), "1000000.000000");
    });
  });

  describe("atomic amounts", () => {
    it("refuses anything that is not a non-negative integer string", () => {
      for (const bad of ["-1", "1.5", "", "abc", "1e6", " 1", "0x10", "＋1"]) {
        throws(() => atomicUnitsToDecimal(bad), `"${bad}" must not decode`);
      }
    });

    it("decodes zero atomic units without inventing a value", () => {
      // Zero is refused on the way IN, but decoding must still be honest about what a
      // stored zero means rather than throwing and hiding it.
      strictEqual(atomicUnitsToDecimal("0"), "0.000000");
    });
  });

  describe("the schema gate rejects impossible amounts first", () => {
    function payload(amount: unknown) {
      return {
        counterparty: "merchant_xyz",
        amount,
        currency: "USDC",
        purpose: "service_fulfillment",
        reference: "invoice_1",
      };
    }

    it("refuses zero, negative, NaN and Infinity before any conversion", () => {
      for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        strictEqual(
          ProposedActionPayloadSchema.safeParse(payload(amount)).success,
          false,
          `${String(amount)} must not parse as a proposal`,
        );
      }
    });

    it("refuses sub-atomic and over-precision amounts before policy evaluation", () => {
      for (const amount of [Number.MIN_VALUE, 0.0000001, 1.1234567]) {
        strictEqual(
          ProposedActionPayloadSchema.safeParse(payload(amount)).success,
          false,
          `${String(amount)} must not parse as a proposal`,
        );
      }
      strictEqual(ProposedActionPayloadSchema.safeParse(payload(0.000001)).success, true);
      strictEqual(ProposedActionPayloadSchema.safeParse(payload(1.123456)).success, true);
      // Binary floating-point multiplication is not itself a decimal precision test:
      // 4.091509 * 1e6 is 4091509.0000000005 in JS, despite the input being valid.
      strictEqual(ProposedActionPayloadSchema.safeParse(payload(4.091509)).success, true);
    });

    it("refuses a string amount rather than coercing it", () => {
      // A coerced "5" would pass every downstream numeric check while having arrived
      // as attacker-controlled text.
      strictEqual(ProposedActionPayloadSchema.safeParse(payload("5")).success, false);
    });

    it("accepts a legitimate amount", () => {
      const parsed = ProposedActionPayloadSchema.safeParse(payload(0.5));
      ok(parsed.success);
      strictEqual(parsed.data.amount, 0.5);
    });
  });
});
