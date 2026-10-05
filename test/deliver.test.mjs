// Regression (ChatGPT test, 2026-10-05): the builder checked the agent but the user never got the file.
// A passing check must tell the AI to hand over the complete file, by name.
import test from "node:test";
import assert from "node:assert/strict";
import worker, { checkAgent } from "../src/index.js";
import { readFileSync } from "node:fs";

test("passing check_agent instructs full-file delivery", async () => {
  const code = readFileSync(new URL("./fixtures/greeting_agent.py", import.meta.url), "utf8");
  const fn = "greeting_agent.py";
  assert.ok(checkAgent(fn, code).passed, "fixture agent should pass");
  const r = await (await worker.fetch(new Request("https://x.test/mcp", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "check_agent", arguments: { filename: fn, code } } }) }), {})).json();
  const text = r.result.content[0].text;
  assert.match(text, /PASSED/);
  assert.match(text, /complete greeting_agent\.py/);
  assert.match(text, /python code block/);
  assert.match(text, /download/);
  assert.ok(r.result.structuredContent.deliver);
});
