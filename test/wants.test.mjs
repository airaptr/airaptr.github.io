// "I want this" (POST /want): a person asks for card checkout. No table in practice mode, so recorded is false
// and the page still gets a plain answer; bad input is refused before anything is written or logged.
import test from "node:test";
import assert from "node:assert/strict";

process.env.PORT = "8811";
process.env.X402_NETWORK = "eip155:8453";
process.env.CDP_API_KEY_ID = "not-a-real-key";
process.env.CDP_API_KEY_SECRET = "not-a-real-secret";
const { start } = await import("../local/serve.mjs");
const server = await start();
const B = "http://127.0.0.1:8811";
const want = (body, method = "POST") => fetch(B + "/want", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

test.after(() => { server.closeAllConnections(); server.close(); });

test("a want with no email is accepted and answered plainly", async () => {
  const logged = [];
  const orig = console.log;
  console.log = (line) => { logged.push(String(line)); };
  try {
    const r = await want({ product: "will-it-pass", source: "people-page" });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.recorded, false);                       // practice mode has no table
    assert.match(j.message, /check back/);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
  } finally { console.log = orig; }
  const line = logged.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o?.route === "/want");
  assert.ok(line, "the watcher's log line is written");
  assert.deepEqual([line.evt, line.outcome, line.product, line.email_left], ["paid_call", "want", "will-it-pass", false]);
  assert.equal("email" in line, false);
});

test("an email is validated, kept out of the log, and changes the answer", async () => {
  const logged = [];
  const orig = console.log;
  console.log = (line) => { logged.push(String(line)); };
  try {
    const r = await want({ product: "rejection-rescue", email: "maker@example.com" });
    assert.equal(r.status, 200);
    assert.match((await r.json()).message, /one email/);
  } finally { console.log = orig; }
  assert.ok(!logged.join("\n").includes("maker@example.com"));
  const bad = await want({ product: "rejection-rescue", email: "not an email" });
  assert.equal(bad.status, 400);
});

test("unknown products, bad JSON and GET are refused", async () => {
  assert.equal((await want({ product: "domains" })).status, 400);
  assert.equal((await fetch(B + "/want", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" })).status, 400);
  assert.equal((await want(undefined, "GET")).status, 405);
});
