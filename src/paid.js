// Pay-per-call agent API over x402 (v2). Agents pay a fraction of a cent in USDC per request, no account or key.
// The server never holds keys: a facilitator verifies and settles each payment. Off unless X402_PAY_TO is set.
//
// Settings (environment / Azure app settings):
//   X402_PAY_TO       receiving wallet address (required to switch on)
//   X402_NETWORK      CAIP-2 network, default eip155:84532 (Base Sepolia testnet); eip155:8453 = Base mainnet
//   X402_FACILITATOR  facilitator URL, default https://x402.org/facilitator (testnet)
//   X402_PRICE        price per call, default $0.001

import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { x402HTTPResourceServer } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { orderQuote, fulfilmentReady } from "./domains.js";

export const PAID_ROUTES = ["/x402/world", "/x402/domains/register"];

let cached = null;

export function paidConfig(env = {}) {
  const get = (k) => env[k] || globalThis.process?.env?.[k];
  return {
    payTo: get("X402_PAY_TO"),
    network: get("X402_NETWORK") || "eip155:84532",
    facilitator: get("X402_FACILITATOR") || "https://x402.org/facilitator",
    price: get("X402_PRICE") || "$0.001",
  };
}

async function server(cfg, env = {}) {
  const key = JSON.stringify(cfg);
  if (cached && cached.key === key) return cached.http;
  const resource = new x402ResourceServer(new HTTPFacilitatorClient({ url: cfg.facilitator })).register("eip155:*", new ExactEvmScheme());
  const http = new x402HTTPResourceServer(resource, {
    "GET /x402/world": {
      accepts: { scheme: "exact", network: cfg.network, payTo: cfg.payTo, price: cfg.price },
      description: "DOGG World Check: a fresh, verified snapshot of world numbers (Bitcoin, FX, earthquakes, space weather, ISS) with the public tick, time and SHA-256 fingerprint.",
      mimeType: "application/json",
    },
    // Price is the live registrar price plus margin for the domain in ?domain=, quoted per order.
    "POST /x402/domains/register": {
      accepts: {
        scheme: "exact",
        network: cfg.network,
        payTo: cfg.payTo,
        price: async (ctx) => `$${(await orderQuote(ctx.adapter.getQueryParam?.("domain"), env)).price_usd}`,
      },
      description: "Raptr Domains: register an available domain name. Charged only if registration succeeds.",
      mimeType: "application/json",
    },
  });
  await http.initialize();
  cached = { key, http };
  return http;
}

const adapterFor = (request, url) => ({
  getHeader: (n) => request.headers.get(n) ?? undefined,
  getMethod: () => request.method,
  getPath: () => url.pathname,
  getUrl: () => request.url,
  getAcceptHeader: () => request.headers.get("accept") || "",
  getUserAgent: () => request.headers.get("user-agent") || "",
  getQueryParams: () => Object.fromEntries(url.searchParams),
  getQueryParam: (n) => url.searchParams.get(n) ?? undefined,
});

function toResponse(instr, extra = {}) {
  const isHtml = !!instr.isHtml;
  const body = isHtml ? String(instr.body ?? "") : JSON.stringify(instr.body ?? {});
  return new Response(body, {
    status: instr.status,
    headers: { "Content-Type": isHtml ? "text/html; charset=utf-8" : "application/json", ...instr.headers, ...extra },
  });
}

// produce(): returns the JSON body for a paid call. log(event): usage counter (no payment details).
export async function handlePaid(request, env, produce, log = () => {}, cors = {}) {
  const url = new URL(request.url);
  const cfg = paidConfig(env);
  if (!cfg.payTo) {
    return new Response(JSON.stringify({ error: "Paid access is not switched on yet." }), { status: 503, headers: { "Content-Type": "application/json", ...cors } });
  }
  if (url.pathname === "/x402/domains/register") {
    if (!fulfilmentReady(env)) {
      return new Response(JSON.stringify({ error: "Domain registration is not switched on yet." }), { status: 503, headers: { "Content-Type": "application/json", ...cors } });
    }
    try { await orderQuote(url.searchParams.get("domain"), env); } catch (e) {
      return new Response(JSON.stringify({ error: `Can't sell this domain: ${e.message}.` }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
    }
  }
  const http = await server(cfg, env);
  const result = await http.processHTTPRequest({
    adapter: adapterFor(request, url),
    path: url.pathname,
    method: request.method,
    paymentHeader: request.headers.get("payment-signature") || request.headers.get("x-payment") || undefined,
  });

  if (result.type === "payment-error") {
    log({ route: url.pathname, outcome: "payment_required" });
    return toResponse(result.response, cors);
  }
  if (result.type === "no-payment-required") {
    return new Response(JSON.stringify(await produce()), { headers: { "Content-Type": "application/json", ...cors } });
  }

  // Payment verified: do the work, then settle. Only settle once the work succeeded.
  let body;
  try {
    body = await produce();
  } catch (e) {
    log({ route: url.pathname, outcome: "work_failed" });
    return new Response(JSON.stringify({ error: `Could not produce the snapshot: ${e.message}. You were not charged.` }), { status: 502, headers: { "Content-Type": "application/json", ...cors } });
  }
  const settled = await http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions);
  if (!settled.success) {
    log({ route: url.pathname, outcome: "settle_failed" });
    return new Response(JSON.stringify({ error: "Payment could not be settled.", reason: settled.errorReason }), { status: 402, headers: { "Content-Type": "application/json", ...settled.headers, ...cors } });
  }
  log({ route: url.pathname, outcome: "paid", network: settled.network });
  // Every settled payment becomes a receipt in the books. A ledger failure never takes back the customer's result.
  try {
    // The ledger ships privately (estate repo); public builds simply skip it.
    const { appendReceipt } = await import("./ledger.js").catch(() => ({ appendReceipt: async () => {} }));
    await appendReceipt(env, {
      service: url.pathname === "/x402/world" ? "dogg-world-check" : "raptr-domains",
      route: url.pathname,
      amount: result.paymentRequirements.amount,
      asset: result.paymentRequirements.asset,
      network: settled.network || result.paymentRequirements.network,
      payer: settled.payer,
      tx: settled.transaction,
      detail: url.searchParams.get("domain") || "",
    });
  } catch (e) {
    log({ route: url.pathname, outcome: "ledger_write_failed", error: e.message });
  }
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ...settled.headers, ...cors } });
}
