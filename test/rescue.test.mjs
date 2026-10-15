// Rejection Rescue and the store: the JS port matches rescue.py on the real Rapp Hive rejections, the preview is free,
// the paid route asks for the right price on the right network, refuses bad input before payment, and only hands
// over the full output once a payment has been verified and settled. Payments here go to a local stand-in
// facilitator (no network, no wallet, no money); the dummy pay-to address is never a real wallet.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import worker from "../src/index.js";
import { cited, entryFor, questions, rescue, canonical } from "../src/rescue.js";

const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const ROUND1 = readFileSync(fx("rescue_round1.txt"), "utf8");
const ROUND2 = readFileSync(fx("rescue_round2.txt"), "utf8");
const GOLDEN = JSON.parse(readFileSync(fx("rescue_python.json"), "utf8"));

// ---------- a stand-in facilitator, so the x402 flow runs end to end without the network ----------
const calls = { verify: 0, settle: 0 };
let settleOk = true;
const facilitator = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/supported")) return res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} }));
    if (req.url.endsWith("/verify")) { calls.verify++; return res.end(JSON.stringify({ isValid: true, payer: "0x2222222222222222222222222222222222222222" })); }
    if (req.url.endsWith("/settle")) {
      calls.settle++;
      return res.end(JSON.stringify(settleOk
        ? { success: true, transaction: "0x" + "ab".repeat(32), network: "eip155:84532", payer: "0x2222222222222222222222222222222222222222" }
        : { success: false, errorReason: "insufficient_funds", transaction: "", network: "eip155:84532" }));
    }
    res.statusCode = 404; res.end("{}");
  });
});
await new Promise((r) => facilitator.listen(0, "127.0.0.1", r));
process.env.X402_PAY_TO = "0x1111111111111111111111111111111111111111";
process.env.X402_FACILITATOR = `http://127.0.0.1:${facilitator.address().port}`;
delete process.env.X402_NETWORK;
delete process.env.X402_PRICE_RESCUE;
test.after(() => facilitator.close());

const B = "https://x.test";
const post = (path, body, headers = {}) => worker.fetch(new Request(B + path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), {});
const decode = (h) => JSON.parse(Buffer.from(h, "base64").toString("utf8"));
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function checkReceipt(body) {
  const { sha256: got, sha256_of, ...rest } = body;
  assert.match(got, /^[0-9a-f]{64}$/);
  assert.ok(sha256_of);
  assert.equal(got, await sha256(canonical(rest)), "sha256 must be the hash of the canonical body");
}
// A structurally valid x402 v2 payment for the given requirements (signature is junk; the stand-in accepts it).
const paymentFor = (accepted, url) => Buffer.from(JSON.stringify({
  x402Version: 2,
  resource: { url, description: "", mimeType: "application/json" },
  accepted,
  payload: {
    signature: "0x" + "11".repeat(65),
    authorization: { from: "0x2222222222222222222222222222222222222222", to: accepted.payTo, value: accepted.amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: "0x" + "33".repeat(32) },
  },
})).toString("base64");

// ---------- parity with rescue.py ----------

test("port: sections with sub-letters, in order; most specific entry; unknown is not guessed", () => {
  assert.deepEqual(cited(ROUND2), ["5.1.1(i)", "5.1.2(i)", "5.2.5"]);
  assert.equal(entryFor("5.1.1(v)")[0], "5.1.1");
  assert.equal(entryFor("2.3.3")[0], "2.3.3");
  assert.equal(entryFor("2.3.7")[0], "2.3");
  assert.deepEqual(entryFor("9.9"), [null, null]);
  assert.equal(questions(ROUND1).length, 5);
  const u = rescue("Guideline 9.9 - Something new");
  assert.deepEqual(u.unknown_sections, ["9.9"]);
  assert.deepEqual(u.items, []);
});

test("port matches rescue.py on both real Rapp Hive rejections (golden output)", () => {
  const got = { round1: rescue(ROUND1), round2: rescue(ROUND2), round2_changes: rescue(ROUND2, { changes: GOLDEN.changes }) };
  for (const [k, want] of Object.entries(GOLDEN.cases)) {
    assert.deepEqual(got[k].sections, want.sections, k);
    assert.deepEqual(got[k].reply_missing, want.reply_missing, k);
    assert.deepEqual(got[k], want, `${k}: whole result`);
  }
  assert.equal(got.round2_changes.reply_draft.split("Thank you.").length - 1, 3); // one paragraph per distinct reply
  for (let i = 1; i <= 5; i++) assert.ok(got.round1.reply_draft.includes(`${i}. `));
});

const PY = `${homedir()}/Wildhaven/rapple-factory/rescue/rescue.py`;
test("port matches rescue.py run live (when rapple-factory is beside this repo)", { skip: !existsSync(PY) && "rapple-factory not present" }, () => {
  const py = (text, changes = "", url = "") => {
    const out = JSON.parse(execFileSync("python3", ["-I", "-c",
      "import sys,json;sys.path.insert(0,sys.argv[1]);import rescue as r;d=json.load(sys.stdin);o=r.rescue(d['t'],None,d['c']);" +
      "o['reply_missing']=[m for m in o['reply_missing'] if m];print(json.dumps(o))", PY.replace(/\/rescue\.py$/, "")],
    { input: JSON.stringify({ t: text, c: changes }) }).toString());
    return out;
  };
  const tricky = "guideline 2.3.10 and GUIDELINE 4.8(A)\r\nGuideline 2.1 again, Guideline 2.1\n﻿1) What is this?\n- bullet ask\nIs this a long direct question?\nshort?\nGuideline 7.7";
  for (const [t, c] of [[ROUND1, ""], [ROUND2, GOLDEN.changes], [tricky, "x {recording_url} $& y"]]) assert.deepEqual(rescue(t, { changes: c }), py(t, c));
});

// ---------- the free preview ----------

test("preview is free: 200, no payment asked, sections and meanings, price and route of the full version, receipt", async () => {
  calls.verify = calls.settle = 0;
  const r = await post("/rescue/preview", { text: ROUND2 });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("payment-required"), null);
  const b = await r.json();
  assert.deepEqual(b.sections, ["5.1.1(i)", "5.1.2(i)", "5.2.5"]);
  assert.deepEqual(b.recognized.map((x) => x.title), ["Data Collection and Storage", "Data Use and Sharing", "Apple Products"]);
  assert.ok(b.recognized.every((x) => x.means));
  assert.equal(b.recognized[0].fix, undefined, "the preview must not include the paid part");
  assert.equal(b.reply_draft, undefined);
  assert.equal(b.full_version.price, "$0.50");
  assert.equal(b.full_version.network, "eip155:84532");
  assert.equal(b.full_version.route, `POST ${B}/x402/rescue`);
  await checkReceipt(b);
  assert.equal(calls.verify + calls.settle, 0);
});

test("preview MCP tool is on the builder profile and returns the same", async () => {
  const rpc = async (method, params) => (await post("/mcp", { jsonrpc: "2.0", id: 1, method, params })).json();
  assert.ok((await rpc("tools/list")).result.tools.some((t) => t.name === "rejection_rescue_preview"));
  const r = (await rpc("tools/call", { name: "rejection_rescue_preview", arguments: { text: ROUND2 } })).result;
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /5\.1\.1\(i\) Data Collection and Storage/);
  assert.deepEqual(r.structuredContent.sections, ["5.1.1(i)", "5.1.2(i)", "5.2.5"]);
  const big = (await rpc("tools/call", { name: "rejection_rescue_preview", arguments: { text: "x".repeat(20481) } })).result;
  assert.equal(big.isError, true);
});

test("preview refuses empty, oversize and malformed input", async () => {
  for (const [body, status] of [[{ text: "" }, 400], [{ text: "   " }, 400], ["", 400], ["{not json", 400], [[1, 2], 400], [{ text: 5 }, 400], [{ text: "Guideline 2.1 " + "x".repeat(20 * 1024) }, 413]]) {
    const r = await post("/rescue/preview", body);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 40));
    const b = await r.json();
    assert.ok(b.error);
    await checkReceipt(b);
  }
  assert.equal((await worker.fetch(new Request(B + "/rescue/preview"), {})).status, 405);
});

// ---------- the paid route ----------

test("/x402/rescue without payment: 402 with the rescue price on Base Sepolia, no output", async () => {
  calls.verify = calls.settle = 0;
  const r = await post("/x402/rescue", { text: ROUND2 });
  assert.equal(r.status, 402);
  const req = decode(r.headers.get("payment-required"));
  assert.equal(req.accepts[0].network, "eip155:84532");
  assert.equal(req.accepts[0].amount, "500000"); // $0.50 in USDC's 6 decimals
  assert.equal(req.accepts[0].payTo, process.env.X402_PAY_TO);
  assert.match(req.resource.url, /\/x402\/rescue$/);
  const text = await r.text();
  assert.ok(!text.includes("reply_draft") && !text.includes("Thank you"));
  assert.equal(calls.verify + calls.settle, 0);
});

test("X402_PRICE_RESCUE sets the price", async () => {
  process.env.X402_PRICE_RESCUE = "$0.25";
  try {
    const r = await post("/x402/rescue", { text: ROUND2 });
    assert.equal(decode(r.headers.get("payment-required")).accepts[0].amount, "250000");
    assert.equal((await (await worker.fetch(new Request(B + "/store.json"), {})).json()).products[0].price, "$0.25");
  } finally { delete process.env.X402_PRICE_RESCUE; }
});

test("/x402/rescue refuses empty, oversize, invalid and unrecognized input before payment", async () => {
  calls.verify = calls.settle = 0;
  for (const [body, status] of [[{ text: "" }, 400], ["", 400], ["{bad", 400], [{ text: ["a"] }, 400], [{ text: "Guideline 2.1 " + "y".repeat(20 * 1024) }, 413], [{ text: "Guideline 9.9 - Something new" }, 422], [{ text: "no guideline here" }, 422]]) {
    const r = await post("/x402/rescue", body);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 40));
    assert.equal(r.headers.get("payment-required"), null, "no payment may be asked for");
    const b = await r.json();
    assert.equal(b.charged, false);
    await checkReceipt(b);
  }
  assert.equal(calls.verify + calls.settle, 0);
});

test("/x402/rescue: other methods never produce paid output", async () => {
  for (const method of ["GET", "PUT", "PATCH", "HEAD"]) {
    const r = await worker.fetch(new Request(B + "/x402/rescue", { method }), {});
    assert.equal(r.status, 405, method);
    assert.ok(!(await r.text()).includes("reply_draft"));
  }
  const opt = await worker.fetch(new Request(B + "/x402/rescue", { method: "OPTIONS" }), {});
  assert.equal(opt.status, 204);
  assert.equal(await opt.text(), "");
  for (const p of ["/X402/rescue", "/x402/RESCUE", "/x402/rescue/", "/x402/rescue/x", "/x402/%72escue"]) {
    const r = await post(p, { text: ROUND2 });
    assert.equal(r.status, 404, p);
  }
});

test("paid: verified and settled payment delivers the full rescue with a receipt; settle happens after the work", async () => {
  calls.verify = calls.settle = 0; settleOk = true;
  const unpaid = await post("/x402/rescue", { text: ROUND2 });
  const accepted = decode(unpaid.headers.get("payment-required")).accepts[0];
  const r = await post("/x402/rescue", { text: ROUND2, changes: GOLDEN.changes, recording_url: "https://example.com/rec.mp4" }, { "payment-signature": paymentFor(accepted, `${B}/x402/rescue`) });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("payment-response"), "settlement header");
  const b = await r.json();
  assert.equal(b.product, "rejection-rescue");
  assert.deepEqual(b.sections, ["5.1.1(i)", "5.1.2(i)", "5.2.5"]);
  assert.ok(b.items[0].fix.length && b.cards.length);
  assert.match(b.reply_draft, /Allow \/ Not now/);
  assert.match(b.reply_draft, /https:\/\/example\.com\/rec\.mp4/);
  assert.equal(b.reply_ready, true);
  await checkReceipt(b);
  assert.deepEqual(calls, { verify: 1, settle: 1 });
});

test("paid: if settlement fails, no output and a 402", async () => {
  calls.verify = calls.settle = 0; settleOk = false;
  try {
    const accepted = decode((await post("/x402/rescue", { text: ROUND2 })).headers.get("payment-required")).accepts[0];
    const r = await post("/x402/rescue", { text: ROUND2 }, { "payment-signature": paymentFor(accepted, `${B}/x402/rescue`) });
    assert.equal(r.status, 402);
    assert.ok(!(await r.text()).includes("reply_draft"));
  } finally { settleOk = true; }
});

test("paid: a payment for /x402/world, or a malformed header, does not buy /x402/rescue", async () => {
  calls.verify = calls.settle = 0;
  const worldReq = decode((await worker.fetch(new Request(B + "/x402/world", { headers: { accept: "application/json" } }), {})).headers.get("payment-required")).accepts[0];
  for (const h of [paymentFor(worldReq, `${B}/x402/world`), "garbage", Buffer.from("{}").toString("base64"), Buffer.from(JSON.stringify({ x402Version: 2 })).toString("base64")]) {
    const r = await post("/x402/rescue", { text: ROUND2 }, { "payment-signature": h });
    assert.equal(r.status, 402);
    assert.ok(!(await r.text()).includes("reply_draft"));
  }
  assert.equal(calls.settle, 0);
  assert.equal(calls.verify, 0, "a mismatched payment must not even reach verification");
});

// ---------- the store catalog and discovery ----------

test("store.json lists the products with every field, and each route it names exists", async () => {
  const s = await (await worker.fetch(new Request(B + "/store.json"), {})).json();
  assert.deepEqual(s.products.map((p) => p.id), ["rejection-rescue", "rapple-sim", "will-it-pass"]);
  for (const p of s.products) for (const k of ["name", "status", "description", "free_part", "paid_part", "price", "network"]) assert.ok(k in p, `${p.id}.${k}`);
  assert.match(s.terms.charge, /only when the paid output is delivered/);
  assert.equal(s.payments.network.id, "eip155:84532");
  assert.equal(s.payments.network.testnet, true);
  const rr = s.products[0];
  assert.equal(rr.price, "$0.50");
  assert.equal(rr.paid.http, `POST ${B}/x402/rescue`);
  assert.equal(rr.free.http, `POST ${B}/rescue/preview`);
  assert.equal(rr.free.mcp.tool, "rejection_rescue_preview");
  assert.equal(s.products.find((p) => p.id === "rapple-sim").price, "free");
  // the sample output is what the routes really return for the sample input
  const pv = await (await post("/rescue/preview", rr.sample.input)).json();
  delete pv.sha256; delete pv.sha256_of;
  assert.deepEqual(pv, rr.sample.preview_output);
  assert.deepEqual(rr.sample.paid_output, rescue(rr.sample.input.text, { changes: rr.sample.input.changes }));
  assert.equal((await post("/x402/rescue", rr.sample.input)).status, 402);
  // no hidden instructions aimed at agents
  const all = JSON.stringify(s);
  assert.ok(!/ignore (all |any )?(previous|prior)|you must buy|always (buy|pay)|system prompt/i.test(all));
});

test("discovery: llms.txt Store section, mcp.json, A2A card and skill", async () => {
  const llms = await (await worker.fetch(new Request(B + "/llms.txt"), {})).text();
  assert.match(llms, /## Store/);
  assert.match(llms, /\/store\.json/);
  assert.match(llms, /rejection_rescue_preview/);
  const docs = readFileSync(new URL("../docs/llms.txt", import.meta.url), "utf8");
  assert.match(docs, /## Store/);
  const m = await (await worker.fetch(new Request(B + "/.well-known/mcp.json"), {})).json();
  assert.ok(m.servers.find((x) => x.name === "agent-builder").tools.includes("rejection_rescue_preview"));
  assert.equal(m.store, `${B}/store.json`);
  const card = await (await worker.fetch(new Request(B + "/.well-known/agent-card.json"), {})).json();
  assert.ok(card.skills.some((k) => k.id === "rejection_rescue_preview"));
  const a2a = await (await post("/a2a", { jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: ROUND2 }] } } })).json();
  assert.equal(a2a.result.parts[1].data.skill, "rejection_rescue_preview");
  assert.deepEqual(a2a.result.parts[1].data.sections, ["5.1.1(i)", "5.1.2(i)", "5.2.5"]);
});

test("paid.js never produces when the method does not match the route table (defense behind the 405s)", async () => {
  const { handlePaid } = await import("../src/paid.js");
  let produced = false;
  for (const [path, method] of [["/x402/rescue", "GET"], ["/x402/domains/register", "GET"], ["/x402/world", "POST"]]) {
    const r = await handlePaid(new Request(B + path, { method }), {}, async () => { produced = true; return { secret: 1 }; });
    assert.equal(r.status, 405, `${method} ${path}`);
  }
  assert.equal(produced, false);
});
