// "I want this" (POST /want): a person asks for card checkout. Practice mode has no table, so the honest
// answer is "not saved" (503), the log says want_unsaved, and nothing a caller typed reaches the log.
import test from "node:test";
import assert from "node:assert/strict";

process.env.PORT = "8811";
process.env.X402_NETWORK = "eip155:8453";
process.env.CDP_API_KEY_ID = "not-a-real-key";
process.env.CDP_API_KEY_SECRET = "not-a-real-secret";
const { start } = await import("../local/serve.mjs");
const { parseWant, throttled, MAX_BODY } = await import("../src/wants.js");
const server = await start();
const B = "http://127.0.0.1:8811";
let n = 0;
// Each test speaks from its own address so the per-address throttle doesn't bleed between tests.
const want = (body, method = "POST", headers = {}) =>
  fetch(B + "/want", { method, headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++n}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const capture = async (fn) => {
  const logged = [];
  const orig = console.log;
  console.log = (line) => { logged.push(String(line)); };
  try { return [await fn(), logged]; } finally { console.log = orig; }
};
const wantLine = (logged) => logged.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o?.route === "/want");

test.after(() => { server.closeAllConnections(); server.close(); });

test("without a table the person is told it was not saved, and the log says so", async () => {
  const [r, logged] = await capture(() => want({ product: "will-it-pass", source: "people-page" }));
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.recorded, false);
  assert.match(j.message, /couldn't save/);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const line = wantLine(logged);
  assert.deepEqual([line.evt, line.outcome, line.product, line.email_left, line.source], ["paid_call", "want_unsaved", "will-it-pass", false, "people-page"]);
});

test("nothing a caller typed reaches the log: email never, source only from the allowlist", async () => {
  const [r, logged] = await capture(() => want({ product: "rejection-rescue", email: "maker@example.com", source: "victim@example.com" }));
  assert.equal(r.status, 503);
  const text = logged.join("\n");
  assert.ok(!text.includes("maker@example.com") && !text.includes("victim@example.com"));
  assert.equal(wantLine(logged).source, "api");
  assert.equal("email" in wantLine(logged), false);
  assert.equal((await want({ product: "rejection-rescue", email: "not an email" })).status, 400);
});

test("bad input is refused before anything is parsed or written", async () => {
  assert.equal((await want({ product: "domains" })).status, 400);
  assert.equal((await fetch(B + "/want", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: "{nope" })).status, 400);
  assert.equal((await want(undefined, "GET")).status, 405);
  const big = await want({ product: "will-it-pass", pad: "x".repeat(MAX_BODY) });
  assert.equal(big.status, 413);
  assert.equal(parseWant("x".repeat(MAX_BODY + 1)).status, 413);
  assert.equal(parseWant("[1,2]").status, 400);
});

test("one address gets five an hour, then 429 until the hour passes", async () => {
  const ip = "203.0.113.7";
  for (let i = 0; i < 5; i++) assert.notEqual((await want({ product: "will-it-pass" }, "POST", { "x-forwarded-for": ip })).status, 429);
  assert.equal((await want({ product: "will-it-pass" }, "POST", { "x-forwarded-for": ip })).status, 429);
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) throttled("unit", t0);
  assert.equal(throttled("unit", t0 + 1000), true);
  assert.equal(throttled("unit", t0 + 3_600_001), false);
});
