// Live smoke test of the paid store at https://api.airaptr.com (real money network, Base mainnet).
// Spends nothing: the only "payments" are signed by a throwaway wallet made in memory with zero balance, so Coinbase's
// facilitator must refuse them, and the store must then serve nothing. Run: node test/live_smoke.mjs [base-url]
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const B = process.argv[2] || "https://api.airaptr.com";
const PAY_TO = "0x8eD8A1A6aCF6243fBE448C3D2db5e930A8a98E07";
const REJECTION = "Guideline 2.1 - Performance - App Completeness\n\nWe were unable to review your app as it crashed on launch.";
let pass = 0, fail = 0;
const check = (ok, what, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? "  | " + detail : ""}`); };
const post = (path, body, headers = {}) => fetch(B + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const client = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(privateKeyToAccount(generatePrivateKey()))));
const quoteOf = async (r) => client.getPaymentRequiredResponse((n) => r.headers.get(n), await r.clone().json().catch(() => ({})));

// 1. Payments switched on, real money, facilitator supports us.
const h = await (await fetch(B + "/health/payments")).json();
check(h.ready && h.real_money && h.facilitator_supports_us && h.pay_to === PAY_TO, "payments ready on Base mainnet to your address", JSON.stringify(h));

// 2. Prices are quoted correctly (empty request too, so catalogs can list us).
for (const [path, init, amount] of [["/x402/rescue", { text: REJECTION }, "500000"], ["/x402/rescue", {}, "500000"], ["/x402/world", null, null]]) {
  const r = init ? await post(path, init) : await fetch(B + path);
  const q = (await quoteOf(r)).accepts[0];
  check(r.status === 402 && q.payTo === PAY_TO && q.network === "eip155:8453" && (!amount || q.amount === amount),
    `${path} ${init ? JSON.stringify(init).slice(0, 20) : "GET"} quotes the price`, `${r.status} ${q.amount} ${q.network}`);
}

// 3. Bad input is refused before any payment is asked for, and says it was not charged.
for (const [body, status] of [["{bad", 400], [{ text: "Guideline 9.9 - Something new" }, 422], [{ text: "x".repeat(21 * 1024) }, 413]]) {
  const r = await post("/x402/rescue", body);
  const b = await r.json().catch(() => ({}));
  check(r.status === status && b.charged === false && !r.headers.get("payment-required"), `refuses ${JSON.stringify(body).slice(0, 24)} with ${status}, not charged`, `${r.status}`);
}

// 4. A signed payment from an EMPTY wallet: Coinbase must refuse it and nothing may be served.
for (const [path, init] of [["/x402/rescue", { text: REJECTION }], ["/x402/world", null]]) {
  const unpaid = init ? await post(path, init) : await fetch(B + path);
  const payload = await client.createPaymentPayload(await quoteOf(unpaid));
  const hdr = client.encodePaymentSignatureHeader(payload);
  const r = init ? await post(path, init, hdr) : await fetch(B + path, { headers: hdr });
  const txt = await r.text();
  const reason = (() => { try { return JSON.parse(Buffer.from(r.headers.get("payment-required") || "", "base64")).error; } catch { return ""; } })();
  check(r.status === 402 && !/reply_draft|"proof"|"items"/.test(txt) && !r.headers.get("payment-response"),
    `${path}: empty-wallet payment refused by Coinbase, nothing served, nothing settled`, `${r.status} ${reason || txt.slice(0, 120)}`);
}

// 5. An empty request carrying a payment is refused before verify or settle.
{
  const r = await post("/x402/rescue", { text: "" }, { "x-payment": "eyJ4IjoxfQ==" });
  const b = await r.json().catch(() => ({}));
  check(r.status === 400 && b.charged === false, "empty request with a payment: 400, not charged", `${r.status}`);
}

// 6. The old free hole stays shut.
check((await fetch(B + "/x402/domains/register?domain=example.com")).status === 405, "GET /x402/domains/register is 405");

console.log(`\n${pass} of ${pass + fail} passed against ${B}`);
process.exit(fail ? 1 : 0);
