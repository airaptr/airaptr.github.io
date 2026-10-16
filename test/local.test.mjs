// The local store (local/serve.mjs, practice mode) behaves like the live one and refuses what the live one refuses.
import test from "node:test";
import assert from "node:assert/strict";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

// A shell holding mainnet settings must not matter: the local store forces the test network.
process.env.PORT = "8797";
process.env.X402_NETWORK = "eip155:8453";
process.env.CDP_API_KEY_ID = "not-a-real-key";
process.env.CDP_API_KEY_SECRET = "not-a-real-secret";
const { start } = await import("../local/serve.mjs");
const server = await start();
const B = "http://127.0.0.1:8797";
const TEXT = "Guideline 2.1 - Performance - App Completeness\nThe app crashed on launch.";
const client = new x402HTTPClient(new x402Client().register("eip155:84532", new ExactEvmScheme(privateKeyToAccount(generatePrivateKey()))));
const ask = (headers = {}) => fetch(B + "/x402/rescue", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ text: TEXT }) });
const quote = async () => { const r = await ask(); return client.getPaymentRequiredResponse((n) => r.headers.get(n), await r.json().catch(() => ({}))); };
const sign = async (mutate = (q) => q) => client.encodePaymentSignatureHeader(await client.createPaymentPayload(mutate(await quote())));
const refusedWithNothing = async (r) => {
  assert.notEqual(r.status, 200);
  assert.ok(!(await r.text()).includes("reply_draft"));
  assert.equal(r.headers.get("payment-response"), null);
};

test.after(() => { server.closeAllConnections(); server.close(); });

test("local store is on the test network whatever the shell says", async () => {
  const h = await (await fetch(B + "/health/payments")).json();
  assert.equal(h.network, "eip155:84532");
  assert.equal(h.real_money, false);
  assert.equal((await quote()).accepts[0].network, "eip155:84532");
});

test("an agent asks, pays and gets the rescue", async () => {
  const r = await ask(await sign());
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.items[0].section, "2.1");
  assert.ok(JSON.parse(Buffer.from(r.headers.get("payment-response"), "base64")).success);
});

test("the same payment twice is refused the second time", async () => {
  const h = await sign();
  assert.equal((await ask(h)).status, 200);
  await refusedWithNothing(await ask(h));
});

test("a tampered signature is refused", async () => {
  const h = await sign();
  const [k, v] = Object.entries(h)[0];
  const p = JSON.parse(Buffer.from(v, "base64"));
  p.payload.signature = p.payload.signature.slice(0, -4) + (p.payload.signature.endsWith("aaaa") ? "bbbb" : "aaaa");
  await refusedWithNothing(await ask({ [k]: Buffer.from(JSON.stringify(p)).toString("base64") }));
});

test("paying less, or paying someone else, is refused", async () => {
  const less = (q) => ({ ...q, accepts: [{ ...q.accepts[0], amount: "1" }] });
  const elsewhere = (q) => ({ ...q, accepts: [{ ...q.accepts[0], payTo: privateKeyToAccount(generatePrivateKey()).address }] });
  await refusedWithNothing(await ask(await sign(less)));
  await refusedWithNothing(await ask(await sign(elsewhere)));
});
