// Business Kit server: the four tools answer through MCP with correct math, and only on /kit/mcp.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const rpc = async (path, method, params = {}) => {
  const r = await worker.fetch(new Request("https://x.test" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), {});
  return r.json();
};
const call = (name, args) => rpc("/kit/mcp", "tools/call", { name, arguments: args });

test("kit lists exactly its tools", async () => {
  const r = await rpc("/kit/mcp", "tools/list");
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ["burn_rate", "content_seeds", "find_outliers", "request_service", "setup_checklist"]);
  const b = await rpc("/mcp", "tools/list");
  assert.ok(!b.result.tools.some((t) => t.name === "burn_rate"), "builder listing must not grow kit tools");
});

test("burn_rate: our real bill", async () => {
  const r = await call("burn_rate", { costs: [{ item: "server", monthly: 15.11 }, { item: "disk", monthly: 4.8 }, { item: "public ip", monthly: 3.65 }, { item: "domain", monthly: 1.85 }, { item: "storage", monthly: 2 }, { item: "ai", monthly: 5, always_on: false }], hours_per_day: 8 });
  const s = r.result.structuredContent;
  assert.equal(s.total, 32.41);
  assert.equal(s.under_cap, true);
  assert.equal(s.largest, "server");
  assert.ok(s.if_sleeping < s.total);
});

test("find_outliers: likes beating subscribers is the signal", async () => {
  const r = await call("find_outliers", { videos: [{ title: "small channel hit", subscribers: 1000, likes: 2500, views: 40000 }, { title: "big channel normal", subscribers: 1000000, likes: 20000, views: 300000 }] });
  const o = r.result.structuredContent.outliers;
  assert.equal(o.length, 1);
  assert.equal(o[0].title, "small channel hit");
  assert.equal(o[0].like_ratio, 2.5);
});

test("content_seeds: sorts work like the capture hook", async () => {
  const r = await call("content_seeds", { work: ["Raptr v0.5.0 live on the demo", "fix caption misspelling", "server costs $32 a month", "new guide on Gumroad", "refactor build script"] });
  const k = r.result.structuredContent.seeds.map((s) => s.kind);
  assert.deepEqual(k, ["milestone", "lesson", "number", "product", "build"]);
});

test("setup_checklist: what's left, in order", async () => {
  const r = await call("setup_checklist", { done: ["account", "youtube"] });
  assert.equal(r.result.structuredContent.remaining[0].key, "newsletter");
  assert.equal(r.result.structuredContent.percent, 29);
});

test("bad input is a friendly error, not a crash", async () => {
  const r = await call("burn_rate", { costs: [] });
  assert.equal(r.result.isError, true);
});
