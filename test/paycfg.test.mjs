// The CDP facilitator key must never leak into the config object, /store.json or any response, and mainnet must refuse
// to run without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paidConfig } from "../src/paycfg.js";

const SECRET = "test-secret-value-never-shown-0123456789";

test("the key secret never enters the config object", () => {
  const cfg = paidConfig({ X402_PAY_TO: "0x" + "1".repeat(40), X402_NETWORK: "eip155:8453", CDP_API_KEY_ID: "id-1", CDP_API_KEY_SECRET: SECRET });
  assert.equal(cfg.cdp, true);
  assert.ok(!JSON.stringify(cfg).includes(SECRET));
  assert.ok(!JSON.stringify(cfg).includes("id-1"));
});

test("cdp is false unless both id and secret are set", () => {
  assert.equal(paidConfig({ CDP_API_KEY_ID: "x" }).cdp, false);
  assert.equal(paidConfig({ CDP_API_KEY_SECRET: "y" }).cdp, false);
  assert.equal(paidConfig({}).cdp, false);
});

test("store.json never shows the secret", async () => {
  const { storeCatalog } = await import("../src/store.js");
  const cfg = paidConfig({ X402_PAY_TO: "0x" + "1".repeat(40), X402_NETWORK: "eip155:8453", CDP_API_KEY_ID: "id-1", CDP_API_KEY_SECRET: SECRET });
  assert.ok(!JSON.stringify(storeCatalog("https://api.airaptr.com", cfg)).includes(SECRET));
});
