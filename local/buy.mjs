// Buy from the local store the way an agent would: ask, see the price, pay, get the result.
//
//   node local/buy.mjs [--testnet] ["Apple's rejection text"]
//
// Pays with a test wallet kept at ~/.airaptr-local/test-wallet.json (made on first use, Base Sepolia only, never
// holds real money). Refuses to pay anything but the local store on the test network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const TESTNET = process.argv.includes("--testnet");
const B = process.env.STORE || "http://127.0.0.1:8787";
const TEXT = process.argv.slice(2).find((a) => !a.startsWith("--")) ||
  "Guideline 2.1 - Performance - App Completeness\n\nWe were unable to review your app as it crashed on launch.\n\nGuideline 5.1.1(v) - Data Collection and Storage\n\nThe app supports account creation but does not include an option to delete the account.";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(B)) { console.error("This buyer only pays the local store."); process.exit(2); }

const dir = path.join(os.homedir(), ".airaptr-local");
const file = path.join(dir, "test-wallet.json");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ network: "eip155:84532", note: "TEST wallet for the local store. Never send real money here.", key: generatePrivateKey() }), { mode: 0o600 });
const account = privateKeyToAccount(JSON.parse(fs.readFileSync(file, "utf8")).key);
const client = new x402HTTPClient(new x402Client().register("eip155:84532", new ExactEvmScheme(account)));

const ask = (headers = {}) => fetch(B + "/x402/rescue", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ text: TEXT }) });

console.log(`1. Asking the store to rescue a rejection (${TEXT.split("\n")[0]}…)`);
const first = await ask();
if (first.status !== 402) { console.log(`   Expected a price, got ${first.status}: ${(await first.text()).slice(0, 200)}`); process.exit(1); }
const quote = client.getPaymentRequiredResponse((n) => first.headers.get(n), await first.json().catch(() => ({})));
const q = quote.accepts[0];
if (q.network !== "eip155:84532") { console.log(`   The store asked for ${q.network}, not the test network. Not paying.`); process.exit(1); }
console.log(`2. Price: ${Number(q.amount) / 1e6} USDC on the Base test network, to ${q.payTo.slice(0, 10)}…`);

const paid = await ask(client.encodePaymentSignatureHeader(await client.createPaymentPayload(quote)));
const body = await paid.json().catch(() => ({}));
if (paid.status !== 200) {
  let why = body.error || body.reason || "";
  try { why ||= JSON.parse(Buffer.from(paid.headers.get("payment-required"), "base64")).error; } catch {}
  console.log(`3. Payment refused (${paid.status}): ${why}`);
  if (TESTNET) console.log(`   The test wallet ${account.address} may need free test USDC: https://faucet.circle.com (pick Base Sepolia).`);
  process.exit(1);
}
const settled = JSON.parse(Buffer.from(paid.headers.get("payment-response") || "e30=", "base64").toString());
console.log(`3. Paid. Settlement: ${settled.transaction}${TESTNET ? `  https://sepolia.basescan.org/tx/${settled.transaction}` : " (practice: nothing moved)"}`);
console.log(`4. What the agent got back:`);
for (const it of body.items || []) console.log(`   - ${it.section} ${it.title}: ${it.fix.length} fixes`);
console.log(`   Reply draft: ${body.reply_ready ? "ready" : "needs " + (body.reply_missing || []).filter(Boolean).join(", ")}`);
console.log(`   Receipt: sha256 ${String(body.sha256 || "").slice(0, 16)}…`);
