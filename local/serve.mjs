// The same store, on this computer, where it can never take real money.
//
//   node local/serve.mjs              practice: payments are checked by a local practice checker (real signature
//                                     check, no chain, nothing moves). Works offline, needs no setup.
//   node local/serve.mjs --testnet    Base Sepolia through the public x402.org test facilitator: a real on-chain
//                                     settle with free test USDC (no value). The buyer needs test USDC once.
//
// Whatever the shell holds, this forces the test network and drops Coinbase's key, so a local run cannot touch Base
// mainnet. Store: http://127.0.0.1:8787 (same routes as api.airaptr.com). Buy from it: node local/buy.mjs
import http from "node:http";
import { createHash } from "node:crypto";
import { verifyTypedData } from "viem";

const TESTNET = process.argv.includes("--testnet");
const PORT = Number(process.env.PORT || 8787);
const CHECKER_PORT = PORT + 1;
const NETWORK = "eip155:84532";

for (const k of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "X402_FACILITATOR", "X402_NETWORK"]) delete process.env[k];
process.env.X402_NETWORK = NETWORK;
process.env.X402_PAY_TO ||= "0x8eD8A1A6aCF6243fBE448C3D2db5e930A8a98E07";
process.env.X402_FACILITATOR = TESTNET ? "https://x402.org/facilitator" : `http://127.0.0.1:${CHECKER_PORT}`;

const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });
const send = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

// ---- the practice checker: answers like a facilitator. It really checks the buyer's signature, the amount, the
// payee, the time window and that the authorization is not reused; "settling" only records it.
const used = new Set();
export async function practiceCheck({ paymentPayload: p, paymentRequirements: r }) {
  const a = p?.payload?.authorization, sig = p?.payload?.signature;
  if (!a || !sig) return { isValid: false, invalidReason: "invalid_payload", payer: "" };
  const fail = (why) => ({ isValid: false, invalidReason: why, payer: a.from });
  if (r.network !== NETWORK) return fail("invalid_network");
  if (a.to.toLowerCase() !== r.payTo.toLowerCase()) return fail("invalid_exact_evm_payload_recipient_mismatch");
  if (BigInt(a.value) < BigInt(r.amount)) return fail("invalid_exact_evm_payload_authorization_value");
  const t = Math.floor(Date.now() / 1000);
  if (BigInt(a.validBefore) < BigInt(t + 6) || BigInt(a.validAfter) > BigInt(t)) return fail("invalid_exact_evm_payload_authorization_valid_before");
  if (used.has(a.nonce)) return fail("invalid_exact_evm_payload_authorization_nonce_used");
  const ok = await verifyTypedData({
    address: a.from,
    domain: { name: r.extra?.name, version: r.extra?.version, chainId: 84532, verifyingContract: r.asset },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
    signature: sig,
  }).catch(() => false);
  return ok ? { isValid: true, payer: a.from } : fail("invalid_exact_evm_payload_signature");
}

function startChecker() {
  return http.createServer(async (req, res) => {
    if (req.url === "/supported") return send(res, 200, { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: { "eip155:*": [] } });
    const body = JSON.parse((await readBody(req)) || "{}");
    const v = await practiceCheck(body);
    if (req.url === "/verify") return send(res, 200, v);
    if (req.url === "/settle") {
      if (!v.isValid) return send(res, 200, { success: false, errorReason: v.invalidReason, transaction: "", network: NETWORK, payer: v.payer });
      used.add(body.paymentPayload.payload.authorization.nonce);
      const tx = "0x" + createHash("sha256").update("practice:" + body.paymentPayload.payload.authorization.nonce).digest("hex");
      console.log(`  practice payment: ${Number(body.paymentRequirements.amount) / 1e6} test USDC from ${v.payer.slice(0, 10)}… (nothing moved)`);
      return send(res, 200, { success: true, transaction: tx, network: NETWORK, payer: v.payer });
    }
    send(res, 404, { error: "not found" });
  }).listen(CHECKER_PORT, "127.0.0.1");
}

export async function start() {
  const { default: worker } = await import("../src/index.js");
  const checker = TESTNET ? null : startChecker();
  const server = http.createServer(async (req, res) => {
    const init = { method: req.method, headers: req.headers };
    if (!["GET", "HEAD"].includes(req.method)) init.body = await readBody(req);
    const r = await worker.fetch(new Request(`http://127.0.0.1:${PORT}${req.url}`, init), {});
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(PORT, "127.0.0.1");
  await new Promise((ok) => server.on("listening", ok));
  server.on("close", () => { checker?.closeAllConnections(); checker?.close(); });
  console.log(`Local store: http://127.0.0.1:${PORT}  (${TESTNET ? "Base Sepolia test network, free test USDC" : "practice: nothing moves"}; never real money)`);
  console.log(`Buy from it like an agent:  node local/buy.mjs${TESTNET ? " --testnet" : ""}`);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
