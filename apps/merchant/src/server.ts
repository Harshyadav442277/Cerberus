/**
 * x402 resource server standing in for the merchants the agent pays.
 *
 * This is demo scaffolding. x402 is a buyer/seller HTTP protocol: the payer only
 * pays because a resource server answers with HTTP 402, so the demo needs a payee.
 *
 * It deliberately contains NO governance logic. All mandate evaluation happens in
 * the Disposition Engine on the agent's side, before the agent ever constructs a
 * request to this server (Bible Section 6, Rules R6).
 */
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RouteConfig, RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { env } from "./env.js";

/**
 * The counterparties used by the demo script (Bible Section 9). `merchant_xyz` and
 * `merchant_abc` are on the seed mandate's allowlist; `merchant_new` is not, which
 * is what drives the ESCALATE scenario.
 */
const COUNTERPARTIES = ["merchant_xyz", "merchant_abc", "merchant_new"] as const;

/** Charged when a request does not specify an amount. */
const DEFAULT_PRICE_USD = 0.01;

/**
 * The agent pays the amount it proposed, so price is resolved per request from an
 * `?amount=` query parameter rather than being fixed per route.
 */
function buildRoute(counterparty: string): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: env.network as Network,
      payTo: env.payTo,
      price: (context) => {
        const params = context.adapter.getQueryParams?.() ?? {};
        const raw = params["amount"];
        const value = Array.isArray(raw) ? raw[0] : raw;
        const parsed = Number(value);
        const amount =
          value !== undefined && Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_PRICE_USD;
        return `$${amount.toFixed(6)}`;
      },
    },
    description: `Settle an invoice with ${counterparty} over x402`,
    mimeType: "application/json",
  };
}

const routes: RoutesConfig = Object.fromEntries(
  COUNTERPARTIES.map((c) => [`GET /pay/${c}`, buildRoute(c)]),
);

const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: env.facilitatorUrl }),
);
registerExactEvmScheme(resourceServer, {});

const app = express();

// Unprotected. Used by the Phase 1 preflight check to confirm the server is up
// before attempting a payment.
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    network: env.network,
    facilitator: env.facilitatorUrl,
    payTo: env.payTo,
    counterparties: COUNTERPARTIES,
  });
});

app.use(paymentMiddleware(routes, resourceServer));

for (const counterparty of COUNTERPARTIES) {
  app.get(`/pay/${counterparty}`, (req, res) => {
    // Only reached after the facilitator has settled the payment on-chain.
    res.json({
      settled: true,
      counterparty,
      reference: req.query["reference"] ?? null,
      amount: req.query["amount"] ?? String(DEFAULT_PRICE_USD),
      currency: "USDC",
    });
  });
}

app.listen(env.port, () => {
  console.log(`[merchant] x402 resource server listening on :${env.port}`);
  console.log(`[merchant] network      ${env.network}`);
  console.log(`[merchant] facilitator  ${env.facilitatorUrl}`);
  console.log(`[merchant] payTo        ${env.payTo}`);
  console.log(`[merchant] routes       ${COUNTERPARTIES.map((c) => `/pay/${c}`).join(", ")}`);
});
