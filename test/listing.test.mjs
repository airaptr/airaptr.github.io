// "Will it pass?": the JS port gives the same answer as handbook/tools/appstore_gate.py on the same listings, the
// preview is free and carries no fixes, the paid route asks for $0.50 on the right network, refuses before payment when
// there is nothing to fix, and only hands over the fixes once a payment is verified and settled. URL checks never reach
// local or private addresses. Payments go to a local stand-in facilitator (no network, no wallet, no money).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../src/index.js";
import { runChecks, check, hasFixes, cleanKeywords, imageSize, urlProblem, safeFetch, parseListing, EULA, LIMITS, SHOT_SIZES, APPLE_MARKS, OTHER_MARKS, PLACEHOLDERS, REVIEW_HEADINGS } from "../src/listing.js";
import { canonical } from "../src/rescue.js";

// ---------- a stand-in facilitator ----------
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
delete process.env.X402_PRICE_LISTING;
test.after(() => facilitator.close());

const B = "https://x.test";
const post = (path, body, headers = {}) => worker.fetch(new Request(B + path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), {});
const decode = (h) => JSON.parse(Buffer.from(h, "base64").toString("utf8"));
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function checkReceipt(body) {
  const { sha256: got, sha256_of, ...rest } = body;
  assert.match(got, /^[0-9a-f]{64}$/);
  assert.ok(sha256_of);
  assert.equal(got, await sha256(canonical(rest)));
}
const paymentFor = (accepted, url) => Buffer.from(JSON.stringify({
  x402Version: 2,
  resource: { url, description: "", mimeType: "application/json" },
  accepted,
  payload: {
    signature: "0x" + "11".repeat(65),
    authorization: { from: "0x2222222222222222222222222222222222222222", to: accepted.payTo, value: accepted.amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: "0x" + "33".repeat(32) },
  },
})).toString("base64");

// ---------- listings ----------
const NOTES_OK = `## What it is and who it's for\nA home planner.\n## How to review it\nTap Start.\n## Sign-in\nNone.\n## Outside services\nNone.\n## Regions\nAll.\n## Regulated content\nNone.\n## Screen recording\nhttps://example.org/rec.mp4\n## App Transport Security\nNot used.\n`;
const CLEAN = {
  listing: {
    name: "Hatch Estate", subtitle: "Run your home in one place", promotional_text: "Plan chores and bills together.",
    keywords: "chores,family,planner,bills,household", description: `Requires a Hatch hub on your home network.\n\nTerms of Use: ${EULA}`,
    copyright: "2026 Wildhaven Homes LLC",
  },
  seller: "Wildhaven Homes LLC",
  requires: { what: "a Hatch hub", get_it_url: "https://example.org/get" },
  in_app_purchases: true, supports_tablet: true, demo_mode: "Tap Try the demo", demo_tour: "Settings > Tour",
  screenshots: [{ family: "iphone-6.9", width: 1320, height: 2868 }, { family: "ipad-13", width: 2752, height: 2064 }],
  info_plist: { ITSAppUsesNonExemptEncryption: false, NSCameraUsageDescription: "The camera scans receipts; photos stay on this device and are never uploaded." },
  privacy_manifest: { NSPrivacyTracking: false, NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] }] },
  review_notes: NOTES_OK,
};
const DIRTY = {
  listing: {
    name: "Snap Notes for iPhone and iPad Pro Max", subtitle: "Free ChatGPT notes", promotional_text: "$1 sale today",
    keywords: "notes, notes,,ai,notes,snap", description: "lorem ipsum TODO", copyright: "2025 Example Studio",
  },
  seller: "Wildhaven Homes LLC",
  in_app_purchases: true, supports_tablet: false,
  screenshots: [{ family: "iphone-6.9", width: 1179, height: 2556 }],
  info_plist: { NSCameraUsageDescription: "Camera", NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } },
  privacy_manifest: { NSPrivacyTracking: true, NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: [] }] },
  review_notes: "## How to review it\nTBD\n## Screen recording\nlater\n",
};
const MIXED = {
  listing: { name: "Return Window", subtitle: "Never miss a return date", keywords: "return,window,refund,receipt,deadline", description: "Track return deadlines.", promotional_text: "Know every return date.", copyright: "2026 Kody Wildfeuer" },
  seller: "Kody Wildfeuer",
  supports_tablet: true, demo_mode: "Sample data on first launch",
  screenshots: [{ family: "iphone-6.9", width: 1290, height: 2796 }],
  info_plist: { ITSAppUsesNonExemptEncryption: false, NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } },
  privacy_manifest: { NSPrivacyTracking: false, NSPrivacyAccessedAPITypes: [] },
  review_notes: NOTES_OK,
};
const offline = async (url) => ({ status: 0, error: "offline in tests", body: "", bytes: new Uint8Array() });

// ---------- parity with appstore_gate.py ----------
const GATE = `${homedir()}/Wildhaven/handbook/tools/appstore_gate.py`;
const PARITY_CODES = new Set(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "A1", "A3", "E1", "E2", "E3", "E4", "G1", "G2", "G3"]);
const PY_BUILD = `
import sys, json, pathlib, plistlib, struct, zlib
sys.path.insert(0, sys.argv[1]); import appstore_gate as g
spec = json.load(sys.stdin); root = pathlib.Path(sys.argv[2])
(root / "store").mkdir(parents=True, exist_ok=True)
(root / "Info.plist").write_bytes(plistlib.dumps(spec["info_plist"]))
(root / "PrivacyInfo.xcprivacy").write_bytes(plistlib.dumps(spec["privacy_manifest"]))
(root / "store" / "REVIEW-NOTES.md").write_text(spec.get("review_notes", ""))
for i, s in enumerate(spec.get("screenshots", [])):
    d = root / "store" / "screenshots" / s["family"]; d.mkdir(parents=True, exist_ok=True)
    (d / f"{i}.png").write_bytes(b"\\x89PNG\\r\\n\\x1a\\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", s["width"], s["height"]))
cfg = {k: spec[k] for k in ["listing", "in_app_purchases", "demo_mode", "demo_tour", "requires", "supports_tablet", "custom_eula"] if k in spec}
cfg.update(info_plist="Info.plist", privacy_manifest="PrivacyInfo.xcprivacy")
(root / "store" / "listing.json").write_text(json.dumps(cfg))
print(json.dumps([[s, c] for s, c, t, d in g.run(root / "store" / "listing.json", offline=True).rows]))
`;
test("port matches appstore_gate.py on clean, dirty and mixed listings (when the handbook is beside this repo)", { skip: !existsSync(GATE) && "handbook not present" }, async () => {
  for (const [name, spec] of Object.entries({ CLEAN, DIRTY, MIXED })) {
    const dir = mkdtempSync(join(tmpdir(), "wip-"));
    try {
      const py = JSON.parse(execFileSync("python3", ["-I", "-c", PY_BUILD, GATE.replace(/\/appstore_gate\.py$/, ""), dir], { input: JSON.stringify(spec) }).toString())
        .filter(([, c]) => PARITY_CODES.has(c)).map(([s, c]) => `${c} ${s}`);
      const js = (await runChecks(spec, { fetcher: offline })).rows.filter((r) => PARITY_CODES.has(r.code)).map((r) => `${r.code} ${r.status}`);
      assert.deepEqual(js, py, name);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("word lists, limits and screenshot sizes are the gate's own (when the handbook is beside this repo)", { skip: !existsSync(GATE) && "handbook not present" }, () => {
  const py = JSON.parse(execFileSync("python3", ["-I", "-c", "import sys,json;sys.path.insert(0,sys.argv[1]);import appstore_gate as g;" +
    "print(json.dumps(dict(a=g.APPLE_MARKS,o=g.OTHER_MARKS,p=g.PLACEHOLDERS,r=g.REVIEW_HEADINGS,l=g.LIMITS,e=g.EULA,s={k:sorted(map(list,v)) for k,v in g.SHOT_SIZES.items()})))",
    GATE.replace(/\/appstore_gate\.py$/, "")]).toString());
  assert.deepEqual({ a: APPLE_MARKS, o: OTHER_MARKS, p: PLACEHOLDERS, r: REVIEW_HEADINGS, l: LIMITS, e: EULA },
    { a: py.a, o: py.o, p: py.p, r: py.r, l: py.l, e: py.e });
  assert.deepEqual(Object.fromEntries(Object.entries(SHOT_SIZES).map(([k, v]) => [k, [...v].sort((x, y) => x[0] - y[0])])), py.s);
});

test("the dirty listing fails what it should, with what was found and a fix", async () => {
  const { rows, suggestions } = await runChecks(DIRTY, { fetcher: offline });
  const by = (code) => rows.filter((r) => r.code === code);
  assert.match(by("D2")[0].found, /iphone, ipad/);
  assert.match(by("D3")[0].found, /chatgpt/);
  assert.equal(by("D4")[0].status, "FAIL");
  assert.equal(by("D10")[0].status, "FAIL");
  assert.match(by("D10")[0].fix, /stdeula/);
  assert.equal(by("A2")[0].status, "WARN", "iPhone-only is a warning, not a failure");
  assert.ok(rows.filter((r) => r.status === "FAIL").every((r) => r.fix && r.found), "every failure says what and how");
  assert.ok(rows.filter((r) => r.status === "PASS").every((r) => !r.fix && !r.found));
  assert.ok([...suggestions.name].length <= 30);
  assert.equal(suggestions.keywords, "ai");
});

test("cleanKeywords: trims, de-duplicates, drops name words and trademarks, fits 100", () => {
  assert.equal(cleanKeywords(" notes, Notes,,iphone,chatgpt,scan,snap", "Snap Notes"), "scan");
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(",");
  assert.ok(cleanKeywords(long).length <= 100);
});

test("not sent means NOT_CHECKED, never a guess", async () => {
  const { rows } = await runChecks({ listing: { name: "Plain App", subtitle: "Does one thing well", keywords: "one,thing", promotional_text: "Simple.", description: "A plain app.", copyright: "2026 Someone LLC" } }, { fetcher: offline });
  const nc = rows.filter((r) => r.status === "NOT_CHECKED").map((r) => r.code).sort();
  assert.deepEqual(nc, ["A1", "E1", "E2", "E3", "E4", "G1"].sort());
  assert.ok(rows.filter((r) => r.code === "C1" || r.code === "C2").every((r) => r.status === "FAIL"), "privacy and support URLs are required");
});

test("pages and screenshots by URL: content checks with an injected fetcher", async () => {
  const png = (w, h) => { const b = new Uint8Array(24); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); const dv = new DataView(b.buffer); dv.setUint32(16, w); dv.setUint32(20, h); return b; };
  const pages = {
    "https://p.example/privacy": "Contact privacy@p.example. We retain data 30 days and delete it on request. No third parties.",
    "https://p.example/support": "Write to help@p.example",
    "https://p.example/thin": "We value your privacy.",
  };
  const fetcher = async (url) => url.endsWith(".png") ? { status: 200, body: "", bytes: png(...(url.includes("bad") ? [1000, 2000] : [1320, 2868])) }
    : pages[url] ? { status: 200, body: pages[url], bytes: new Uint8Array() } : { status: 404, body: "", bytes: new Uint8Array() };
  const base = { listing: { ...CLEAN.listing, privacy_policy_url: "https://p.example/privacy", support_url: "https://p.example/support" }, screenshots: [{ family: "iphone-6.9", url: "https://p.example/1.png" }] };
  let rows = (await runChecks(base, { fetcher })).rows;
  assert.deepEqual(rows.filter((r) => ["C1", "C2", "A1"].includes(r.code)).map((r) => r.status), ["PASS", "PASS", "PASS"]);
  rows = (await runChecks({ ...base, listing: { ...base.listing, privacy_policy_url: "https://p.example/thin", support_url: "https://p.example/gone" }, screenshots: [{ family: "iphone-6.9", url: "https://p.example/bad.png" }] }, { fetcher })).rows;
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  assert.match(by.C1.found, /contact.*retention.*third parties/s);
  assert.match(by.C2.found, /HTTP 404/);
  assert.match(by.A1.found, /1000x2000/);
});

test("imageSize reads PNG and JPEG headers", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0x34, 0x05, 0x28, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg), [1320, 2868]);
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
});

// ---------- fetching only public hosts ----------
test("urlProblem refuses local, private and odd URLs", () => {
  for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://10.0.0.5/", "http://2130706433/",
    "http://0x7f000001/", "file:///etc/passwd", "ftp://a.example/", "http://user:pw@a.example/", "http://a.example:8080/", "http://intranet/", "http://box.internal/", "http://nas.local/", "not a url"]) {
    assert.ok(urlProblem(u), u);
  }
  for (const u of ["https://airaptr.github.io/privacy.html", "http://example.com/", "https://a.example:443/x"]) assert.equal(urlProblem(u), null, u);
});

test("safeFetch never follows a redirect to a private address, and reaches no local server", async () => {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }); };
  try {
    const r = await safeFetch("https://public.example.invalid/privacy");
    assert.equal(r.status, 0);
    assert.match(r.error, /IP addresses/);
    assert.deepEqual(seen, ["https://public.example.invalid/privacy"], "the private hop is never fetched");
  } finally { globalThis.fetch = real; }
  const local = http.createServer((q, s) => s.end("secret")); await new Promise((r) => local.listen(0, "127.0.0.1", r));
  try {
    const r = await safeFetch(`http://127.0.0.1:${local.address().port}/`);
    assert.equal(r.status, 0);
    assert.equal(r.body, "");
  } finally { local.close(); }
});

test("private IPv6 forms and repeated URLs: refused, and fetched once", async () => {
  const { privateIp } = await import("../src/listing.js");
  for (const ip of ["::1", "::", "::ffff:7f00:1", "::ffff:127.0.0.1", "::127.0.0.1", "fd00::1", "fe80::1", "ff02::1", "64:ff9b::a9fe:a9fe", "10.1.2.3", "100.64.0.1", "169.254.169.254", "0.0.0.0", "224.0.0.1"]) assert.ok(privateIp(ip), ip);
  for (const ip of ["8.8.8.8", "2606:4700::6810:84e5", "140.82.112.3"]) assert.ok(!privateIp(ip), ip);
  let n = 0;
  const fetcher = async () => { n++; return { status: 404, body: "", bytes: new Uint8Array() }; };
  const u = "https://same.example.net/x";
  await runChecks({ listing: { name: "A", privacy_policy_url: u, support_url: u, marketing_url: u }, screenshots: Array(10).fill({ family: "iphone-6.9", url: u + ".png" }) }, { fetcher });
  assert.equal(n, 2, "one page fetch and one screenshot fetch");
});

test("A4 (our tour advice) alone is not something to charge for", async () => {
  const full = { checks: [{ code: "A4", status: "WARN" }, { code: "D1", status: "PASS" }] };
  assert.equal(hasFixes(full), false);
  assert.equal(hasFixes({ checks: [{ code: "A2", status: "WARN" }] }), true);
});

test("safeFetch refuses a public-looking name that resolves to a private address", async () => {
  const r = await safeFetch("http://localtest.me/"); // public DNS name that points at 127.0.0.1
  assert.equal(r.status, 0);
  assert.ok(/private address|could not connect/.test(r.error), r.error);
});

// ---------- input ----------
test("parseListing: accepts store/listing.json or top-level fields; refuses bad shapes", () => {
  assert.equal(parseListing(JSON.stringify({ name: "A", subtitle: "B" })).input.listing.name, "A");
  assert.ok(parseListing(JSON.stringify({ listing: { name: "A" }, app_root: "..", extra: 1 })).input);
  for (const [b, status] of [["", 400], ["{x", 400], ["[1]", 400], ["{}", 400], [JSON.stringify({ listing: { name: 5 } }), 400], [JSON.stringify({ listing: { name: "" } }), 400],
    [JSON.stringify({ listing: { name: "A" }, screenshots: [{ family: "watch" }] }), 400], [JSON.stringify({ listing: { name: "A" }, screenshots: Array(11).fill({ family: "iphone-6.9", url: "https://a.example/x.png" }) }), 400],
    [JSON.stringify({ listing: { name: "A" }, info_plist: [] }), 400], [JSON.stringify({ listing: { name: "A", description: "x".repeat(70000) } }), 413]]) {
    assert.equal(parseListing(b).status, status, b.slice(0, 60));
  }
});

// ---------- Sol's hostile review, 2026-10-16: each finding stays fixed ----------
test("wrong types are refused, never coerced into a PASS", () => {
  for (const extra of [{ supports_tablet: "false" }, { in_app_purchases: "false" }, { custom_eula: "false" }, { demo_mode: {} }, { demo_tour: [] },
    { seller: 5 }, { open_source_url: [] }, { requires: { what: 1 } }, { human: { physical_device_tested: {} } }]) {
    assert.equal(parseListing(JSON.stringify({ listing: { name: "A" }, ...extra })).status, 400, JSON.stringify(extra));
  }
});

test("human: false is not confirmed; true and a string are", async () => {
  const h = async (v) => (await runChecks({ listing: { name: "A" }, human: { physical_device_tested: v } }, { fetcher: offline })).human.find((x) => x.key === "physical_device_tested").confirmed;
  assert.equal(await h(false), false);
  assert.equal(await h(""), false);
  assert.equal(await h(true), true);
  assert.equal(await h("build 7 on an iPhone 15"), true);
});

test("every screenshot sent is checked against its own family, not only the required ones", async () => {
  const { rows } = await runChecks({ listing: { name: "A" }, screenshots: [{ family: "iphone-6.9", width: 1320, height: 2868 }, { family: "iphone-6.5", width: 1, height: 1 }] }, { fetcher: offline });
  const a1 = rows.filter((r) => r.code === "A1");
  assert.deepEqual(a1.map((r) => r.status), ["PASS", "FAIL"]);
  assert.match(a1[1].found, /1x1/);
});

test("subtitle and promotional text are optional: absent is a PASS, too long is a FAIL", async () => {
  const d1 = async (L) => (await runChecks({ listing: { name: "A", ...L } }, { fetcher: offline })).rows.filter((r) => r.code === "D1").map((r) => `${r.check.split(" ")[0]} ${r.status}`);
  assert.deepEqual(await d1({}), ["name PASS", "subtitle PASS", "promotional_text PASS", "keywords FAIL", "description FAIL"]);
  assert.ok((await d1({ promotional_text: "x".repeat(171) })).includes("promotional_text FAIL"));
});

test("concurrent requests: each preview quotes its own origin", async () => {
  const real = globalThis.fetch;
  let release;
  const gate = new Promise((r) => (release = r));
  globalThis.fetch = async () => { await gate; return new Response("nope", { status: 404 }); };
  try {
    const req = (host) => worker.fetch(new Request(`https://${host}/listing/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listing: { name: "A", privacy_policy_url: "https://slow.example.net/p" } }) }), {});
    const victim = req("victim.example.net");
    await new Promise((r) => setTimeout(r, 20));
    const other = req("other.example.net");
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [v, o] = await Promise.all([victim, other]).then((rs) => Promise.all(rs.map((r) => r.json())));
    assert.equal(v.full_version.route, "POST https://victim.example.net/x402/listing");
    assert.equal(o.full_version.route, "POST https://other.example.net/x402/listing");
  } finally { globalThis.fetch = real; }
});

test("a factory store/listing.json as-is (plist paths, notes file, extra keys) is accepted; paths are NOT_CHECKED", async () => {
  const factory = { _about: "x", info_plist: "App/Info.plist", privacy_manifest: "App/PrivacyInfo.xcprivacy", screenshots_dir: "store/screenshots", review_notes_file: "store/REVIEW-NOTES.md",
    supports_tablet: false, in_app_purchases: false, demo_mode: "Home > Try it", demo_tour: "Home > Tour", age_rating_answers: { a: 1 }, human: { physical_device_tested: "build 3" }, listing: CLEAN.listing };
  const parsed = parseListing(JSON.stringify(factory));
  assert.ok(parsed.input, parsed.error);
  const { rows } = await runChecks(parsed.input, { fetcher: offline });
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  assert.equal(by.E1.status, "NOT_CHECKED");
  assert.match(by.E1.found, /file path \(App\/Info\.plist\)/);
  assert.equal(by.E2.status, "NOT_CHECKED");
  assert.match(by.E2.found, /file path/);
});

// ---------- the free preview ----------
test("preview is free: 200, no payment asked, statuses only (no found, no fix), price of the full version, receipt", async () => {
  calls.verify = calls.settle = 0;
  const r = await post("/listing/preview", DIRTY);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("payment-required"), null);
  const b = await r.json();
  assert.ok(b.checks.length > 20);
  assert.ok(b.checks.every((c) => c.found === undefined && c.fix === undefined), "the preview must not include the paid part");
  assert.equal(b.suggestions, undefined);
  assert.ok(b.summary.fail > 5);
  assert.equal(b.full_version.available, true);
  assert.equal(b.full_version.price, "$0.50");
  assert.equal(b.full_version.route, `POST ${B}/x402/listing`);
  assert.match(b.summary.note, /does not mean Apple will approve/);
  await checkReceipt(b);
  assert.equal(calls.verify + calls.settle, 0);
  assert.equal((await worker.fetch(new Request(B + "/listing/preview"), {})).status, 405);
  const bad = await post("/listing/preview", "{x");
  assert.equal(bad.status, 400);
  await checkReceipt(await bad.json());
});

test("preview MCP tool lives on /appstore/mcp (not on the ChatGPT-listed builder)", async () => {
  const rpc = async (path, method, params) => (await post(path, { jsonrpc: "2.0", id: 1, method, params })).json();
  assert.ok((await rpc("/appstore/mcp", "tools/list")).result.tools.some((t) => t.name === "will_it_pass_preview"));
  assert.ok(!(await rpc("/mcp", "tools/list")).result.tools.some((t) => t.name === "will_it_pass_preview"));
  const r = (await rpc("/appstore/mcp", "tools/call", { name: "will_it_pass_preview", arguments: DIRTY })).result;
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /NOT READY/);
  assert.match(r.content[0].text, /x402\/listing/);
  const e = (await rpc("/appstore/mcp", "tools/call", { name: "will_it_pass_preview", arguments: { listing: {} } })).result;
  assert.equal(e.isError, true);
});

// ---------- the paid route ----------
test("/x402/listing without payment: 402 at $0.50 on Base Sepolia, valid Bazaar block, no fixes in it", async () => {
  calls.verify = calls.settle = 0;
  const r = await post("/x402/listing", DIRTY);
  assert.equal(r.status, 402);
  const req = decode(r.headers.get("payment-required"));
  assert.equal(req.accepts[0].amount, "500000");
  assert.equal(req.accepts[0].network, "eip155:84532");
  assert.match(req.resource.url, /\/x402\/listing$/);
  assert.ok(req.resource.description.length <= 500);
  const { validateAndExtract } = await import("@x402/extensions/bazaar");
  const v = validateAndExtract(req.extensions.bazaar);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  assert.equal(req.extensions.bazaar.info.output.example.product, "will-it-pass");
  await checkReceipt(req.extensions.bazaar.info.output.example);
  assert.ok(!(await r.text()).includes('"fix"'));
  assert.equal(calls.verify + calls.settle, 0);
});

test("/x402/listing refuses before payment: bad input, and a listing with nothing to fix", async () => {
  calls.verify = calls.settle = 0;
  const nothing = { ...CLEAN, listing: { ...CLEAN.listing } }; delete nothing.requires;
  const fetcherFree = { ...nothing, listing: { ...nothing.listing } }; // no URLs: C1/C2 would fail, so give a listing whose only gaps are people items
  for (const [body, status] of [["{bad", 400], [{ listing: { name: 7 } }, 400], [{ listing: { name: "A", description: "x".repeat(70000) } }, 413]]) {
    const r = await post("/x402/listing", body);
    assert.equal(r.status, status);
    assert.equal(r.headers.get("payment-required"), null);
    const b = await r.json();
    assert.equal(b.charged, false);
    await checkReceipt(b);
  }
  // nothing to fix: every check passes (pages served by a stubbed global fetch for this one call)
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("Contact us at help@p.example. We retain data 30 days and delete it on request. No third parties.", { status: 200 });
  try {
    const perfect = { ...fetcherFree, listing: { ...fetcherFree.listing, privacy_policy_url: "https://hatch.example.net/privacy", support_url: "https://hatch.example.net/support" } };
    const full = await check(perfect);
    assert.deepEqual(full.checks.filter((c) => c.status !== "PASS").map((c) => c.code), [], "fixture must be perfect");
    const r = await post("/x402/listing", perfect);
    assert.equal(r.status, 422);
    assert.equal(r.headers.get("payment-required"), null);
    const b = await r.json();
    assert.equal(b.charged, false);
  } finally { globalThis.fetch = real; }
  assert.equal(calls.verify + calls.settle, 0);
});

test("/x402/listing: unpaid empty request gets the price quote, never output; empty with payment is refused before verify", async () => {
  calls.verify = calls.settle = 0;
  for (const body of ["", "{}"]) {
    const r = await post("/x402/listing", body);
    assert.equal(r.status, 402, JSON.stringify(body));
  }
  const r = await post("/x402/listing", "{}", { "payment-signature": "eyJ4IjoxfQ==" });
  assert.equal(r.status, 400);
  assert.equal(calls.verify + calls.settle, 0);
});

test("paid: verified and settled payment delivers the fixes with a receipt; settle once, after the work", async () => {
  calls.verify = calls.settle = 0; settleOk = true;
  const accepted = decode((await post("/x402/listing", DIRTY)).headers.get("payment-required")).accepts[0];
  const r = await post("/x402/listing", DIRTY, { "payment-signature": paymentFor(accepted, `${B}/x402/listing`) });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("payment-response"));
  const b = await r.json();
  assert.equal(b.product, "will-it-pass");
  assert.ok(b.checks.filter((c) => c.status === "FAIL").every((c) => c.fix));
  assert.ok(b.suggestions.name);
  await checkReceipt(b);
  assert.deepEqual(calls, { verify: 1, settle: 1 });
});

test("paid: settlement fails → no output; other methods and paths never produce output", async () => {
  settleOk = false;
  try {
    const accepted = decode((await post("/x402/listing", DIRTY)).headers.get("payment-required")).accepts[0];
    const r = await post("/x402/listing", DIRTY, { "payment-signature": paymentFor(accepted, `${B}/x402/listing`) });
    assert.equal(r.status, 402);
    assert.ok(!(await r.text()).includes('"fix"'));
  } finally { settleOk = true; }
  for (const method of ["GET", "PUT"]) assert.equal((await worker.fetch(new Request(B + "/x402/listing", { method }), {})).status, 405);
  for (const p of ["/x402/LISTING", "/x402/listing/", "/x402/listing/x"]) assert.equal((await post(p, DIRTY)).status, 404, p);
});

test("store.json lists Will it pass? as available at $0.50 with a real sample; X402_PRICE_LISTING sets the price", async () => {
  const cat = await (await worker.fetch(new Request(B + "/store.json"), {})).json();
  const p = cat.products.find((x) => x.id === "will-it-pass");
  assert.equal(p.status, "available");
  assert.equal(p.price, "$0.50");
  assert.equal(p.sample.paid_output.product, "will-it-pass");
  assert.ok(p.sample.paid_output.summary.fail > 0);
  assert.ok(p.sample.preview_output.checks.every((c) => c.fix === undefined));
  process.env.X402_PRICE_LISTING = "$1.00";
  try {
    assert.equal(decode((await post("/x402/listing", DIRTY)).headers.get("payment-required")).accepts[0].amount, "1000000");
  } finally { delete process.env.X402_PRICE_LISTING; }
  const llms = await (await worker.fetch(new Request(B + "/llms.txt"), {})).text();
  assert.match(llms, /x402\/listing/);
  assert.doesNotMatch(llms, /Coming soon:.*Will it pass/);
});
