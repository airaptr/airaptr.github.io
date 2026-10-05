// Stored test: every ChatGPT plugin package stays within OpenAI's listing rules.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";

const packages = {
  "openai-plugin": "https://airaptr-api.azurewebsites.net/mcp",
  "openai-plugin-finder": "https://airaptr-api.azurewebsites.net/finder/mcp",
  "openai-plugin-world": "https://airaptr-api.azurewebsites.net/world/mcp",
  "openai-plugin-domains": "https://airaptr-api.azurewebsites.net/domains/mcp",
  "openai-plugin-names": "https://airaptr-api.azurewebsites.net/names/mcp",
  "openai-plugin-kit": "https://airaptr-api.azurewebsites.net/kit/mcp",
  "openai-plugin-shorts": "https://shorts-api.wonderfulcoast-92452b49.eastus2.azurecontainerapps.io/mcp",
};

for (const [dir, url] of Object.entries(packages)) {
  test(`${dir} fits OpenAI's listing limits`, () => {
    const read = (p) => JSON.parse(readFileSync(new URL(`../${dir}/${p}`, import.meta.url), "utf8"));
    const plugin = read("plugin.json");
    const servers = Object.values(read("mcp.json").mcpServers);
    assert.equal(servers.length, 1);
    assert.deepEqual(servers[0], { type: "streamable-http", url });
    const ui = plugin.extensions["com.openai"].interface;
    assert.ok(ui.displayName.length <= 30, ui.displayName);
    assert.ok(ui.shortDescription.length <= 30, ui.shortDescription);
    assert.ok(ui.longDescription.length <= 4000);
    assert.ok(ui.developerName.length <= 80);
    assert.ok(ui.defaultPrompt.every((p) => p.length <= 128));
    assert.ok(ui.capabilities.every((c) => c.length <= 120));
    for (const u of [ui.websiteURL, ui.supportURL, ui.privacyPolicyURL, ui.termsOfServiceURL]) assert.match(u, /^https:\/\//);
    for (const f of [ui.logo, ui.composerIcon]) assert.ok(existsSync(new URL(`../${dir}/${f.slice(2)}`, import.meta.url)), f);
    const t = plugin.extensions["com.openai"].review.test_cases;
    assert.equal(t.positive.length, 5);
    assert.equal(t.negative.length, 3);
  });
}
