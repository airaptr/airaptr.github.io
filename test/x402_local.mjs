// Stored test: the paid route speaks x402 v2 correctly. Uses Base Sepolia (testnet) and a throwaway,
// unfunded wallet generated in memory, so no real money is involved and nothing is persisted.
import worker from "../src/index.js";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const PAY_TO = privateKeyToAccount(generatePrivateKey()).address; // throwaway receiving address
process.env.X402_PAY_TO = PAY_TO;
const URL_ = "http://local.test/x402/world";
const call = (headers = {}) => worker.fetch(new Request(URL_, { headers: { accept: "application/json", ...headers } }), {});

// 1) No payment: 402 with machine-readable requirements.
const r1 = await call();
const body1 = await r1.json();
const client = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(privateKeyToAccount(generatePrivateKey()))));
const req = client.getPaymentRequiredResponse((n) => r1.headers.get(n), body1);
const acc = req.accepts[0];
console.log("1. unpaid:", r1.status, "| network", acc.network, "| amount", acc.amount, "(USDC atomic) | payTo matches", acc.payTo.toLowerCase() === PAY_TO.toLowerCase(), "| asset", acc.asset);

// 2) Signed by an empty wallet: the facilitator must refuse and we must not serve the data.
const payload = await client.createPaymentPayload(req);
const r2 = await call(client.encodePaymentSignatureHeader(payload));
const b2 = await r2.text();
console.log("2. empty wallet:", r2.status, "|", b2.slice(0, 220).replace(/\s+/g, " "));
console.log(r2.status === 402 && !b2.includes('"proof"') ? "PASS: refused, no data served" : "FAIL");

// 3) Not configured: switched off.
delete process.env.X402_PAY_TO;
const r3 = await worker.fetch(new Request(URL_), {});
console.log("3. no pay-to set:", r3.status);
