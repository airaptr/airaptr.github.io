// Pay-per-call agent API over x402 (v2). Agents pay a fraction of a cent in USDC per request, no account or key.
// The server never holds keys: a facilitator verifies and settles each payment. Off unless X402_PAY_TO is set.
//
// Settings (environment / Azure app settings):
//   X402_PAY_TO       receiving wallet address (required to switch on)
//   X402_NETWORK      CAIP-2 network, default eip155:84532 (Base Sepolia testnet); eip155:8453 = Base mainnet
//   X402_FACILITATOR  facilitator URL, default https://x402.org/facilitator (testnet)
//   X402_PRICE        price per call, default $0.001
//   X402_PRICE_RESCUE price of the full Rejection Rescue, default $0.50
//   X402_PRICE_LISTING price of the full "Will it pass?" listing check, default $0.50

import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { x402HTTPResourceServer } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { orderQuote, fulfilmentReady } from "./domains.js";
import { paidConfig } from "./paycfg.js";

export { paidConfig };

export const PAID_ROUTES = ["/x402/world", "/x402/domains/register", "/x402/rescue", "/x402/listing"];
const SERVICE = { "/x402/world": "dogg-world-check", "/x402/domains/register": "raptr-domains", "/x402/rescue": "rejection-rescue", "/x402/listing": "will-it-pass" };
const METHOD = { "/x402/world": "GET", "/x402/domains/register": "POST", "/x402/rescue": "POST", "/x402/listing": "POST" };

let cached = null;

// ---------- Bazaar discovery (x402 extension): how to call each paid route and what comes back ----------
// Coinbase's facilitator lists a route in the x402 Bazaar after it settles a payment for it. Descriptions stay plain:
// what the route does, what it takes, what it costs and when it charges. /x402/domains/register is not declared.

const RESCUE_SAMPLE = "Guideline 2.1 - Performance - App Completeness\n\nThe app crashed on launch on iPad Air (5th generation) running iPadOS 18.\n\n1. Please provide a demo account.";
const str = { type: "string" };
const strs = { type: "array", items: str };

export const DISCOVERY_TEXT = {
  "/x402/listing": "Will it pass?: send an App Store listing (name, subtitle, keywords, description, copyright, privacy and support URLs; optionally screenshots, review notes, Info.plist) before submitting; get every machine-checkable rejection reason found, with the guideline section and the exact fix, plus trimmed fields and cleaned keywords. Refused before payment if nothing fails. Charged only when the output is delivered.",
  "/x402/rescue": "Rejection Rescue: send the text of an Apple App Review rejection; get back, for each cited guideline the playbook covers, what it means, likely causes, checks and a fix list, plus a reply draft to App Review that answers each of Apple's questions. Text that cites no covered guideline is refused before payment. Charged only when the output is delivered.",
  "/x402/world": "DOGG World Check: a fresh snapshot of public world numbers (Bitcoin price and block height, crypto market, USD exchange rates, earthquakes in the past hour, space weather, Space Station position) with the snapshot's tick, time and SHA-256 fingerprint, checkable against the public feed.",
};

async function rescueDiscovery() {
  const { rescue, withReceipt } = await import("./rescue.js");
  const item = {
    type: "object",
    properties: {
      section: str, playbook: str, title: str, means: str,
      likely_causes: strs, check: strs, evidence: strs, fix: strs,
    },
  };
  return declareDiscoveryExtension({
    bodyType: "json",
    input: { text: RESCUE_SAMPLE },
    inputSchema: {
      properties: {
        text: { type: "string", description: "Apple's rejection message, as received (cites guidelines such as \"Guideline 2.1\"). Up to 20 KB." },
        changes: { type: "string", description: "Optional: what you changed; fills the reply draft's list of changes." },
        recording_url: { type: "string", description: "Optional: link to a screen recording on a real device; fills the reply draft's recording link." },
      },
      required: ["text"],
    },
    output: {
      // A real output for the sample input above (the playbook as deployed).
      example: await withReceipt({ product: "rejection-rescue", ...rescue(RESCUE_SAMPLE) }),
      schema: {
        type: "object",
        properties: {
          product: { type: "string", const: "rejection-rescue" },
          sections: { ...strs, description: "Guideline sections cited in the text, in order." },
          items: { type: "array", items: item, description: "One entry per cited section the playbook covers." },
          unknown_sections: { ...strs, description: "Cited sections the playbook does not cover." },
          apple_asked: { ...strs, description: "Apple's numbered asks and direct questions." },
          cards: { ...strs, description: "The fix list, one line per step, tagged with its section." },
          reply_draft: { type: "string", description: "A reply to App Review; bracketed placeholders mark what is still missing." },
          reply_ready: { type: "boolean" },
          reply_missing: strs,
          sha256: { type: "string", description: "SHA-256 of this object without sha256 and sha256_of, as canonical JSON." },
          sha256_of: { type: "string" },
        },
        required: ["product", "sections", "items", "cards", "reply_draft", "reply_ready", "sha256"],
      },
    },
  });
}

async function listingDiscovery() {
  const { check } = await import("./listing.js");
  const { withReceipt } = await import("./rescue.js");
  const { SAMPLE_LISTING } = await import("./store.js");
  const row = { type: "object", properties: { code: str, status: { type: "string", enum: ["PASS", "FAIL", "WARN", "NOT_CHECKED"] }, check: str, section: str, found: str, fix: str } };
  return declareDiscoveryExtension({
    bodyType: "json",
    input: SAMPLE_LISTING,
    inputSchema: {
      properties: {
        listing: { type: "object", description: "name, subtitle, promotional_text, keywords, description, copyright, privacy_policy_url, support_url, marketing_url (strings)." },
        seller: { type: "string", description: "Optional: legal name of the seller, to check the copyright line." },
        screenshots: { type: "array", description: "Optional: [{family: iphone-6.9|iphone-6.5|ipad-13, url} or {family, width, height}]." },
        review_notes: { type: "string", description: "Optional: the App Review notes." },
        info_plist: { type: "object", description: "Optional: Info.plist keys as JSON." },
      },
      required: ["listing"],
    },
    output: {
      // A real output for the sample input above.
      example: await withReceipt(await check(SAMPLE_LISTING)),
      schema: {
        type: "object",
        properties: {
          product: { type: "string", const: "will-it-pass" },
          summary: { type: "object", description: "Counts of PASS, FAIL, WARN, NOT_CHECKED and the verdict." },
          checks: { type: "array", items: row, description: "Every check, in order, with what was found and the fix." },
          suggestions: { type: "object", description: "Field values that fit Apple's limits: name, subtitle, description, keywords." },
          people_must_confirm: { type: "array", description: "What only a person can confirm, with evidence if sent." },
          sha256: { type: "string", description: "SHA-256 of this object without sha256 and sha256_of, as canonical JSON." },
          sha256_of: str,
        },
        required: ["product", "summary", "checks", "sha256"],
      },
    },
  });
}

function worldDiscovery() {
  return declareDiscoveryExtension({
    output: {
      example: {
        data: { btc_usd: { spot: "82314.085" }, btc_block_height: { height: 971620 }, fx_usd: { EUR: "0.8944", GBP: "0.7562" }, earthquakes_past_hour: { count: 6, max_mag: "3.6" }, space_weather: { kp: "3.0" }, iss: { lat: "26.393", lon: "-109.679" } },
        proof: { tick: 2792, time_utc: "2026-10-15T20:21:10.296Z", fingerprint: "614d76483ef1dbd6ee8d68a44c66f45fcb22d2ebb63deb0b31b2882a95f2c2b9", tick_fingerprint: "32f9a4f62c713dd76239798191d3c3dd0162ba217d47bf266a4d44fd6a4195d7", source: "https://kody-w.github.io/dogg/orient.json" },
        summary: "Bitcoin: $82,314\n...\n\nVerified snapshot: tick 2792 at 2026-10-15T20:21:10.296Z, fingerprint 614d7648...",
      },
      schema: {
        type: "object",
        properties: {
          data: { type: "object", description: "The snapshot's numbers, keyed by source (btc_usd, fx_usd, iss, ...). Keys can vary with the feed." },
          proof: {
            type: "object",
            properties: { tick: { type: "number" }, time_utc: str, fingerprint: str, tick_fingerprint: str, source: str },
          },
          summary: { type: "string", description: "The same numbers as plain text." },
        },
        required: ["data", "proof", "summary"],
      },
    },
  });
}

async function server(cfg, env = {}) {
  const key = JSON.stringify(cfg);
  if (cached && cached.key === key) return cached.http;
  const get = (k) => env[k] || globalThis.process?.env?.[k];
  // Real money (Base mainnet) settles through Coinbase's facilitator, authenticated with the CDP key; the free x402.org
  // facilitator is testnet only. Refuse a mainnet config without the key rather than take payments that can't settle.
  if (cfg.network === "eip155:8453" && !cfg.cdp) throw new Error("Base mainnet needs CDP_API_KEY_ID and CDP_API_KEY_SECRET");
  const facilitator = cfg.cdp
    ? (await import("@coinbase/x402")).createFacilitatorConfig(get("CDP_API_KEY_ID"), get("CDP_API_KEY_SECRET"))
    : { url: cfg.facilitator };
  const resource = new x402ResourceServer(new HTTPFacilitatorClient(facilitator))
    .register("eip155:*", new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  const http = new x402HTTPResourceServer(resource, {
    "GET /x402/world": {
      accepts: { scheme: "exact", network: cfg.network, payTo: cfg.payTo, price: cfg.price },
      description: DISCOVERY_TEXT["/x402/world"],
      mimeType: "application/json",
      serviceName: "DOGG World Check",
      tags: ["world-data", "bitcoin", "exchange-rates", "earthquakes", "snapshot"],
      extensions: worldDiscovery(),
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
    "POST /x402/rescue": {
      accepts: { scheme: "exact", network: cfg.network, payTo: cfg.payTo, price: cfg.priceRescue },
      description: DISCOVERY_TEXT["/x402/rescue"],
      mimeType: "application/json",
      serviceName: "airaptr Rejection Rescue",
      tags: ["app-store", "app-review", "ios", "rejection"],
      extensions: await rescueDiscovery(),
    },
    "POST /x402/listing": {
      accepts: { scheme: "exact", network: cfg.network, payTo: cfg.payTo, price: cfg.priceListing },
      description: DISCOVERY_TEXT["/x402/listing"],
      mimeType: "application/json",
      serviceName: "airaptr Will it pass?",
      tags: ["app-store", "app-review", "ios", "listing", "pre-submission"],
      extensions: await listingDiscovery(),
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

function methodNotAllowed(request, url, log, cors) {
  log({ route: url.pathname, outcome: "method_not_allowed" });
  return new Response(JSON.stringify({ error: `${request.method} is not allowed here; use ${METHOD[url.pathname]}.` }), { status: 405, headers: { "Content-Type": "application/json", Allow: METHOD[url.pathname] || "", ...cors } });
}

// produce(): returns the JSON body for a paid call. log(event): usage counter (no payment details).
// Can we actually get paid? Asks the configured facilitator (with our key, for real money) what it supports, and says
// whether it settles our scheme on our network. Free; never shows the key; cached for 5 minutes.
let readyCache = null;
export async function paymentsReady(env = {}) {
  if (readyCache && Date.now() - readyCache.at < 300000) return readyCache.result;
  const cfg = paidConfig(env);
  const get = (k) => env[k] || globalThis.process?.env?.[k];
  let result;
  try {
    if (!cfg.payTo) throw new Error("no receiving address set");
    if (cfg.network === "eip155:8453" && !cfg.cdp) throw new Error("real money needs the facilitator key");
    const fac = cfg.cdp
      ? (await import("@coinbase/x402")).createFacilitatorConfig(get("CDP_API_KEY_ID"), get("CDP_API_KEY_SECRET"))
      : { url: cfg.facilitator };
    const supported = await new HTTPFacilitatorClient(fac).getSupported();
    const kinds = (supported.kinds || []).map((k) => `${k.scheme}@${k.network}`);
    const ok = kinds.includes(`exact@${cfg.network}`);
    result = { ready: ok, network: cfg.network, real_money: cfg.network === "eip155:8453", pay_to: cfg.payTo,
               facilitator_supports_us: ok, ...(ok ? {} : { detail: `facilitator offers: ${kinds.slice(0, 12).join(", ")}` }) };
  } catch (e) {
    result = { ready: false, network: cfg.network, real_money: cfg.network === "eip155:8453", detail: String(e.message || e).slice(0, 200) };
  }
  readyCache = { at: Date.now(), result };
  return result;
}

export async function handlePaid(request, env, produce, log = () => {}, cors = {}) {
  const url = new URL(request.url);
  const cfg = paidConfig(env);
  if (!cfg.payTo) {
    return new Response(JSON.stringify({ error: "Paid access is not switched on yet." }), { status: 503, headers: { "Content-Type": "application/json", ...cors } });
  }
  if (request.method !== METHOD[url.pathname]) return methodNotAllowed(request, url, log, cors);
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
  // Every paid route is in the route table, so "no payment required" only means the method didn't match it
  // (e.g. GET on a POST route). Never produce paid output on that path.
  if (result.type === "no-payment-required") return methodNotAllowed(request, url, log, cors);

  // Payment verified: do the work, then settle. Only settle once the work succeeded.
  let body;
  try {
    body = await produce();
  } catch (e) {
    log({ route: url.pathname, outcome: "work_failed" });
    return new Response(JSON.stringify({ error: `Could not produce the result: ${e.message}. You were not charged.` }), { status: 502, headers: { "Content-Type": "application/json", ...cors } });
  }
  const settled = await http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions);
  if (!settled.success) {
    log({ route: url.pathname, outcome: "settle_failed", reason: settled.errorReason });
    return new Response(JSON.stringify({ error: "Payment could not be settled.", reason: settled.errorReason }), { status: 402, headers: { "Content-Type": "application/json", ...settled.headers, ...cors } });
  }
  log({ route: url.pathname, outcome: "paid", network: settled.network, amount: result.paymentRequirements.amount, tx: settled.transaction });
  // Every settled payment becomes a receipt in the books. A ledger failure never takes back the customer's result.
  try {
    // The ledger ships privately (estate repo); public builds simply skip it.
    const { appendReceipt } = await import("./ledger.js").catch(() => ({ appendReceipt: async () => {} }));
    await appendReceipt(env, {
      service: SERVICE[url.pathname],
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
