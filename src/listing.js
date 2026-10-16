// "Will it pass?": an App Store listing in, every check a machine can run before App Review sees it.
// A port of handbook/tools/appstore_gate.py (server side: the listing arrives as JSON, not as an app repo).
// Keep the two in step; test/listing.test.mjs runs both on the same listings when the handbook is beside this repo.
//
// Differences from the gate, on purpose:
//   - Anything not sent is NOT_CHECKED (the gate reads files; a missing file there is a FAIL).
//   - The copyright seller is the buyer's own (seller), not Wildhaven's.
//   - A4 (a self-playing tour) is our own practice, not Apple's rule: WARN, not FAIL.
//   - Subtitle and promotional text are optional in App Store Connect: length-checked only when sent.
//   - Every screenshot sent is checked against its own family, not only the families Apple requires.
//   - Things only a person can confirm (a real-device test, App Privacy answers...) are a checklist, never a FAIL.
//
// Free: preview() says pass or fail per check. Paid (POST /x402/listing): check() adds what was found and the fix.

export const MAX_LISTING_BYTES = 64 * 1024;
export const MAX_SCREENSHOTS = 10;

export const LIMITS = { name: 30, subtitle: 30, promotional_text: 170, keywords: 100, description: 4000 };
const OPTIONAL_FIELDS = new Set(["subtitle", "promotional_text"]);

// 5.2.5: Rapp Hive was rejected for "iPhone" in its subtitle (2026-10-09).
export const APPLE_MARKS = ["iphone", "ipad", "ipod", "mac", "macos", "macbook", "imac", "siri", "apple", "ios", "ipados",
  "watchos", "visionos", "airpods", "facetime", "imessage", "app store", "testflight",
  "apple intelligence", "apple watch", "vision pro", "icloud", "airplay", "carplay"];
// 2.3.7 / 5.2.1: other companies' names in the searchable fields read as keyword stuffing or impersonation.
export const OTHER_MARKS = ["chatgpt", "openai", "claude", "anthropic", "copilot", "github", "tailscale", "google", "gemini",
  "microsoft", "windows", "android", "teamviewer", "anydesk", "zoom", "slack", "discord", "meta",
  "whatsapp", "instagram", "tiktok", "youtube", "amazon", "alexa", "netflix", "spotify"];
export const PLACEHOLDERS = ["example studio", "example.com", "lorem", "ipsum", "todo", "tbd", "coming soon", "your company",
  "acme", "placeholder", "xxx"];
export const EULA = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

// The six things Apple asked Rapp Hive for under 2.1 (2026-09-26), plus sign-in. Headings in the review notes.
export const REVIEW_HEADINGS = ["What it is and who it's for", "How to review it", "Sign-in", "Outside services", "Regions",
  "Regulated content", "Screen recording"];

// Accepted screenshot sizes (portrait and landscape both allowed). Wrong sizes are refused at upload.
export const SHOT_SIZES = {
  "iphone-6.9": [[1320, 2868], [1290, 2796]],
  "iphone-6.5": [[1284, 2778], [1242, 2688]],
  "ipad-13": [[2064, 2752], [2048, 2732]],
};

const HUMAN_ITEMS = {
  physical_device_tested: "Tested on a real device through TestFlight (2.1); name the build and device",
  screen_recording: "Screen recording on a real device: launch, normal flow, a real connection or purchase (2.1)",
  app_privacy_answered: "App Privacy questions answered in App Store Connect (blocks submission)",
  age_rating_answered: "Age rating questionnaire answered in App Store Connect (blocks submission)",
  external_testflight_rehearsal: "One external TestFlight round passed beta review (rehearsal)",
};
const HUMAN_ITEMS_PAID = {
  paid_apps_agreement_active: "Paid Apps Agreement is Active (Business > Agreements); only the Account Holder can sign",
  purchase_attached_to_version: "Every in-app purchase/subscription attached to this version (3.1.1)",
};

// Guideline section and the fix for each check. The fix is the paid part.
const SECTION = {
  D1: "2.3.7", D2: "5.2.5", D3: "2.3.7, 5.2.1", D4: "2.3.7", D5: "2.3.7", D6: "2.1, 2.3", D7: "2.3", D8: "2.3.1",
  D9: "2.3.1, 4.2", D10: "3.1.2", A1: "2.3.3", A2: "2.1, 2.4.1", A3: "2.1", A4: "2.1", E1: "export compliance",
  E2: "5.1.1", E3: "5.1.1(ii)", E4: "1.6", G1: "2.1", G2: "2.1", G3: "2.1", C1: "5.1.1(i)", C2: "1.5", C3: "2.3",
  C4: "2.1, 4.2",
};

// ---------- small helpers (same behaviour as the Python gate) ----------

const len = (s) => [...String(s)].length; // Python len(): code points
function wordsIn(text, marks) {
  const low = " " + String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  return marks.filter((m) => low.includes(` ${m} `));
}
const str = (v) => (typeof v === "string" ? v : "");
// Evidence for a people item: a non-empty string, or true. false or "" is not confirmed.
const evidence = (v) => (v === true ? "yes" : str(v).trim());
const dims = (wh) => `${wh[0]}x${wh[1]}`;
const sizeOk = (family, w, h) => (SHOT_SIZES[family] || []).some(([a, b]) => (a === w && b === h) || (a === h && b === w));

/** Trim to at most n characters at a word boundary, for a suggested shorter field. */
function trimTo(s, n) {
  const cps = [...s];
  if (cps.length <= n) return s;
  const cut = cps.slice(0, n).join("");
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:-]+$/, "");
}

/** Keywords cleaned: no spaces around commas, no empties, no duplicates, no words already in the name/subtitle, ≤100. */
export function cleanKeywords(kw, name = "", subtitle = "") {
  const title = new Set((name + " " + subtitle).toLowerCase().match(/[a-z0-9]+/g) || []);
  const seen = new Set(), out = [];
  for (const raw of String(kw).split(",")) {
    const k = raw.trim();
    const low = k.toLowerCase();
    if (!k || seen.has(low) || title.has(low)) continue;
    if (wordsIn(k, APPLE_MARKS).length || wordsIn(k, OTHER_MARKS).length) continue;
    seen.add(low);
    if (len([...out, k].join(",")) > LIMITS.keywords) continue;
    out.push(k);
  }
  return out.join(",");
}

// ---------- fetching public pages and screenshots, safely ----------
// Only public http(s) hosts on the default ports; no IP literals, no local or internal names; redirects re-checked
// (at most 3); names that resolve to private addresses are refused where DNS is available (Node). Bodies are capped.

const BLOCKED_SUFFIX = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];
export function privateIp(ip) {
  if (/^(::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.test(ip)) {
    const [a, b] = ip.replace(/^::ffff:/i, "").split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  // "::…" covers ::, ::1, IPv4-mapped/compatible in hex (::ffff:7f00:1); then unique-local, link-local, multicast,
  // NAT64 (64:ff9b::) and documentation ranges. Anything unusual is refused rather than reasoned about.
  return v.startsWith("::") || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff") || v.startsWith("64:ff9b:") ||
    v.startsWith("2001:db8:") || v.startsWith("100::") || !v.includes(":");
}

export function urlProblem(raw) {
  let u;
  try { u = new URL(raw); } catch { return "not a valid URL"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "only http(s) URLs are checked";
  if (u.username || u.password) return "URLs with a user name or password are not checked";
  if (u.port && u.port !== "80" && u.port !== "443") return "only the default ports are checked";
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h.includes(".") || h === "localhost" || BLOCKED_SUFFIX.some((s) => h.endsWith(s))) return "not a public host name";
  if (/^[\d.]+$/.test(h) || h.startsWith("[") || /^0x/i.test(h)) return "IP addresses are not checked; use the public host name";
  return null;
}

async function resolvesPrivate(host) {
  let dns;
  try { dns = await import("node:dns"); } catch { return false; } // not on Node (Workers): the host checks above still apply
  try {
    const addrs = await dns.promises.lookup(host, { all: true });
    return addrs.some((a) => privateIp(a.address));
  } catch { return false; } // unresolvable: the fetch itself will fail
}

/** GET a public URL. Returns {status, body (text, capped), bytes (Uint8Array, capped)}; status 0 + error on failure. */
export async function safeFetch(raw, { maxBytes = 400_000, timeoutMs = 8000, range = false } = {}) {
  let url = raw;
  const deadline = Date.now() + timeoutMs; // one budget for every hop, so redirects can't stretch it
  for (let hop = 0; hop <= 3; hop++) {
    if (Date.now() >= deadline) return { status: 0, error: "timed out", body: "", bytes: new Uint8Array() };
    const bad = urlProblem(url);
    if (bad) return { status: 0, error: bad, body: "", bytes: new Uint8Array() };
    if (await resolvesPrivate(new URL(url).hostname)) return { status: 0, error: "host resolves to a private address", body: "", bytes: new Uint8Array() };
    let r;
    try {
      r = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        headers: { "User-Agent": "airaptr-will-it-pass/1", ...(range ? { Range: `bytes=0-${maxBytes - 1}` } : {}) },
      });
    } catch (e) {
      return { status: 0, error: e.name === "TimeoutError" ? "timed out" : "could not connect", body: "", bytes: new Uint8Array() };
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = new URL(r.headers.get("location"), url).href;
      try { await r.body?.cancel(); } catch {}
      continue;
    }
    const chunks = [];
    let total = 0;
    if (r.body) {
      const reader = r.body.getReader();
      try {
        while (total < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.length;
        }
      } catch {} finally { try { await reader.cancel(); } catch {} }
    }
    const bytes = new Uint8Array(Math.min(total, maxBytes));
    let o = 0;
    for (const c of chunks) { const n = Math.min(c.length, bytes.length - o); if (n <= 0) break; bytes.set(c.subarray(0, n), o); o += n; }
    const status = r.status === 206 ? 200 : r.status;
    return { status, body: new TextDecoder("utf-8", { fatal: false }).decode(bytes), bytes };
  }
  return { status: 0, error: "too many redirects", body: "", bytes: new Uint8Array() };
}

/** Width and height of a PNG or JPEG from its first bytes, or null. */
export function imageSize(b) {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    return [dv.getUint32(16), dv.getUint32(20)];
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const segLen = (b[i + 2] << 8) | b[i + 3];
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
      i += 2 + segLen;
    }
  }
  return null;
}

// ---------- input ----------

const LISTING_FIELDS = ["name", "subtitle", "promotional_text", "keywords", "description", "copyright", "privacy_policy_url", "support_url", "marketing_url"];

/** Parse the request body into {input} or {status, error}. Accepts a store/listing.json as-is, or the listing fields at the top level. */
export function parseListing(raw) {
  const size = new TextEncoder().encode(raw).length;
  if (size > MAX_LISTING_BYTES) return { status: 413, error: `Input is ${size} bytes; the limit is ${MAX_LISTING_BYTES} bytes (64 KB).` };
  if (!raw.trim()) return { status: 400, empty: true, error: 'Empty input. Send {"listing": {"name": "...", "subtitle": "...", "keywords": "...", "description": "..."}}. See /store.json.' };
  let cfg;
  try { cfg = JSON.parse(raw); } catch { return { status: 400, error: "Body is not valid JSON. See /store.json for the shape." }; }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return { status: 400, error: "Body must be a JSON object. See /store.json for the shape." };
  if (cfg.listing === undefined && LISTING_FIELDS.some((k) => k in cfg)) {
    const listing = {};
    for (const k of LISTING_FIELDS) if (k in cfg) listing[k] = cfg[k];
    cfg = { ...cfg, listing };
  }
  const L = cfg.listing;
  if (!L || typeof L !== "object" || Array.isArray(L)) return { status: 400, empty: true, error: 'No listing. Send {"listing": {"name": "...", "subtitle": "...", "keywords": "...", "description": "..."}}.' };
  for (const k of LISTING_FIELDS) if (L[k] !== undefined && L[k] !== null && typeof L[k] !== "string") return { status: 400, error: `listing.${k} must be a string.` };
  if (!LISTING_FIELDS.some((k) => str(L[k]).trim())) return { status: 400, empty: true, error: "The listing has no fields filled in." };
  if (cfg.screenshots !== undefined) {
    if (!Array.isArray(cfg.screenshots)) return { status: 400, error: 'screenshots must be a list: [{"family": "iphone-6.9", "url": "https://..."} or {"family": "...", "width": 1320, "height": 2868}].' };
    if (cfg.screenshots.length > 40) return { status: 400, error: "At most 40 screenshots." };
    for (const s of cfg.screenshots) {
      if (!s || typeof s !== "object" || !SHOT_SIZES[s.family]) return { status: 400, error: `Each screenshot needs a family: one of ${Object.keys(SHOT_SIZES).join(", ")}.` };
      const hasDims = Number.isInteger(s.width) && Number.isInteger(s.height);
      if (!hasDims && typeof s.url !== "string") return { status: 400, error: "Each screenshot needs width and height (whole numbers) or a url." };
    }
    if (cfg.screenshots.filter((s) => !(Number.isInteger(s.width) && Number.isInteger(s.height))).length > MAX_SCREENSHOTS) {
      return { status: 400, error: `At most ${MAX_SCREENSHOTS} screenshots by url; send width and height for the rest.` };
    }
  }
  // Wrong types are refused, never coerced: "false" (a string) must not count as yes.
  for (const k of ["supports_tablet", "in_app_purchases", "custom_eula"]) {
    if (cfg[k] !== undefined && cfg[k] !== null && typeof cfg[k] !== "boolean") return { status: 400, error: `${k} must be true or false.` };
  }
  for (const k of ["seller", "demo_mode", "demo_tour", "open_source_url"]) {
    if (cfg[k] !== undefined && cfg[k] !== null && typeof cfg[k] !== "string") return { status: 400, error: `${k} must be a string.` };
  }
  for (const k of ["info_plist", "privacy_manifest", "human", "requires"]) {
    // A factory store/listing.json names the plist files by path; that is accepted and reported as NOT_CHECKED.
    if ((k === "info_plist" || k === "privacy_manifest") && typeof cfg[k] === "string") continue;
    if (cfg[k] !== undefined && cfg[k] !== null && (typeof cfg[k] !== "object" || Array.isArray(cfg[k]))) return { status: 400, error: `${k} must be a JSON object.` };
  }
  if (cfg.requires) for (const k of ["what", "get_it_url"]) {
    if (cfg.requires[k] !== undefined && cfg.requires[k] !== null && typeof cfg.requires[k] !== "string") return { status: 400, error: `requires.${k} must be a string.` };
  }
  if (cfg.human) for (const [k, v] of Object.entries(cfg.human)) {
    if (v !== null && typeof v !== "string" && typeof v !== "boolean") return { status: 400, error: `human.${k} must be a string (the evidence).` };
  }
  if (cfg.review_notes !== undefined && cfg.review_notes !== null && typeof cfg.review_notes !== "string") return { status: 400, error: "review_notes must be a string (the App Review notes)." };
  return { input: cfg };
}

// ---------- the checks ----------

/**
 * Run every check. Returns {rows, human, suggestions}. Each row: {code, status, check, section, found, fix}.
 * status: PASS | FAIL | WARN | NOT_CHECKED. fetcher is injectable for tests.
 */
export async function runChecks(cfg, { fetcher: rawFetcher = safeFetch } = {}) {
  // Each URL is fetched at most once per run, however often it appears in the listing.
  const memo = new Map();
  const fetcher = (url, o) => { const k = `${url} ${JSON.stringify(o || {})}`; if (!memo.has(k)) memo.set(k, rawFetcher(url, o)); return memo.get(k); };
  const L = cfg.listing || {};
  const rows = [];
  const add = (status, code, check, found = "", fix = "") => rows.push({ code, status, check, section: SECTION[code] || "", found: status === "PASS" ? "" : found, fix: status === "PASS" ? "" : fix });
  const chk = (ok, code, check, found, fix) => add(ok ? "PASS" : "FAIL", code, check, found, fix);
  const suggestions = {};

  // ---- D. The listing ----
  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = str(L[field]);
    if (!value && OPTIONAL_FIELDS.has(field)) { add("PASS", "D1", `${field} (optional) not set`); continue; }
    const ok = Boolean(value) && len(value) <= limit;
    if (!ok && value) suggestions[field] = field === "keywords" ? cleanKeywords(value, str(L.name), str(L.subtitle)) : trimTo(value, limit);
    chk(ok, "D1", `${field} present and within ${limit} characters`, `${len(value)} characters`,
      value ? `Cut ${field} to ${limit} characters or fewer (now ${len(value)}).${suggestions[field] ? " A version that fits is in suggestions." + field + "." : ""}` : `Fill in ${field}; App Store Connect needs it.`);
  }

  const searchable = [str(L.name), str(L.subtitle), str(L.keywords).replaceAll(",", " "), str(L.promotional_text)].join(" ");
  let hits = wordsIn(searchable, APPLE_MARKS);
  chk(!hits.length, "D2", "No Apple product names in name, subtitle, keywords or promotional text (5.2.5)", "found: " + hits.join(", "),
    `Take ${hits.map((h) => `"${h}"`).join(", ")} out of the name, subtitle, keywords and promotional text. Say which devices it runs on in the description instead, written the way Apple writes its product names.`);
  hits = wordsIn([str(L.name), str(L.subtitle), str(L.keywords).replaceAll(",", " ")].join(" "), OTHER_MARKS);
  chk(!hits.length, "D3", "No other companies' names in name, subtitle or keywords (2.3.7, 5.2.1)", "found: " + hits.join(", "),
    `Take ${hits.map((h) => `"${h}"`).join(", ")} out of the name, subtitle and keywords. If the app works with that service, say so in the description.`);
  hits = searchable.toLowerCase().match(/\$\s?\d|\bfree\b|\bsale\b|\b\d+% off\b/g) || [];
  chk(!hits.length, "D4", "No prices or 'free' in name, subtitle, keywords or promotional text (2.3.7)", "found: " + hits.join(", "),
    "Remove prices, 'free', 'sale' and discounts from the name, subtitle, keywords and promotional text. The price shows on the store page by itself.");

  const kw = str(L.keywords);
  const parts = kw.split(",");
  const bad = parts.filter((p) => p !== p.trim() || !p);
  const dupes = [...new Set(parts.filter((p, i) => parts.indexOf(p) !== i))].sort();
  if (bad.length || dupes.length) suggestions.keywords ??= cleanKeywords(kw, str(L.name), str(L.subtitle));
  chk(!bad.length && !dupes.length, "D5", "Keywords: comma-separated, no spaces around commas, no duplicates",
    `spacing/empty: ${JSON.stringify(bad)} duplicates: ${JSON.stringify(dupes)}`, "Use the cleaned keywords in suggestions.keywords: commas with no spaces, each word once.");
  const titleWords = new Set((str(L.name) + " " + str(L.subtitle)).toLowerCase().match(/[a-z0-9]+/g) || []);
  const wasted = parts.filter((p) => titleWords.has(p.trim().toLowerCase()));
  if (wasted.length) {
    suggestions.keywords ??= cleanKeywords(kw, str(L.name), str(L.subtitle));
    add("WARN", "D5", "Keywords repeat words already in the name or subtitle (wasted space)", wasted.join(", "),
      "Apple already searches the name and subtitle; drop those words from keywords and use the room for new ones (suggestions.keywords).");
  }

  const everything = JSON.stringify(L).toLowerCase();
  hits = PLACEHOLDERS.filter((p) => everything.includes(p));
  chk(!hits.length, "D6", "No placeholder text anywhere in the listing", "found: " + hits.join(", "),
    `Replace the placeholder text (${hits.join(", ")}) with the real thing. Note: this is a plain text match, so a real word that contains one of these (e.g. "todo" in an app name) shows here too; check each.`);

  const cr = str(L.copyright);
  const seller = str(cfg.seller).trim();
  const year = new Date().getUTCFullYear();
  chk(/^20\d\d /.test(cr) && (seller ? cr.endsWith(seller) : cr.trim().length > 5), "D7",
    seller ? `Copyright is '<year> ${seller}'` : "Copyright is '<year> <seller>' (send seller to check the name too)",
    `got: ${JSON.stringify(cr)}`, `Set copyright to "${year} ${seller || "<the legal name of the seller>"}".`);

  const desc = str(L.description);
  const pending = []; // network checks, run together
  if (/open[- ]source/i.test(desc)) {
    const url = str(cfg.open_source_url);
    pending.push(async () => {
      const r = url ? await fetcher(url) : { status: 0, error: "no open_source_url" };
      chk(r.status === 200, "D8", "Description says open source: the source is public (2.3.1)", `open_source_url ${url || "(missing)"} answered ${r.status}${r.error ? ` (${r.error})` : ""}`,
        "Make the source public and send its URL as open_source_url, or take 'open source' out of the description.");
    });
  } else add("PASS", "D8", "Description makes no open-source claim (or it is backed by a public URL)");

  const req = cfg.requires && typeof cfg.requires === "object" ? cfg.requires : null;
  if (req) {
    chk(/\brequires?\b|\bneed\b|\bneeds\b/i.test(desc), "D9", "Description says up front what the user needs before the app is useful (2.3.1, 4.2)",
      "no 'Requires…' / 'You need…' sentence", `Start the description with "Requires ${str(req.what) || "<what it needs>"}." so nobody installs it without it.`);
  } else add("PASS", "D9", "App needs nothing else to be useful");

  if (!cfg.in_app_purchases) add("PASS", "D10", "No purchases, so no Terms of Use (EULA) link needed (3.1.2 covers subscriptions)");
  else if (!cfg.custom_eula) chk(desc.includes(EULA), "D10", "Description ends with the Terms of Use (EULA) link (3.1.2)", "EULA URL missing",
    `End the description with "Terms of Use: ${EULA}" (or set a custom EULA in App Store Connect and send custom_eula: true).`);
  else add("PASS", "D10", "Custom Terms of Use (EULA) set in App Store Connect");

  // ---- A. Screenshots, iPad ----
  const tablet = Boolean(cfg.supports_tablet);
  if (!Array.isArray(cfg.screenshots)) {
    add("NOT_CHECKED", "A1", "Screenshots: at least one per required device size, every one an accepted size (2.3.3)", "not sent",
      'Send screenshots: [{"family": "iphone-6.9", "url": "https://..."}] or with width and height.');
  } else {
    const needed = ["iphone-6.9", ...(tablet ? ["ipad-13"] : [])];
    pending.push(async () => {
      const sized = await Promise.all(cfg.screenshots.map(async (s, i) => {
        if (Number.isInteger(s.width) && Number.isInteger(s.height)) return { ...s, wh: [s.width, s.height], label: `#${i + 1}` };
        const r = await fetcher(s.url, { maxBytes: 262_144, range: true });
        return { ...s, wh: r.status === 200 ? imageSize(r.bytes) : null, label: s.url, err: r.status === 200 ? "not a PNG or JPEG" : `answered ${r.status}${r.error ? ` (${r.error})` : ""}` };
      }));
      const families = [...new Set([...needed, ...sized.map((s) => s.family)])];
      for (const family of families) {
        const mine = sized.filter((s) => s.family === family);
        const wrong = mine.filter((s) => !s.wh || !sizeOk(family, s.wh[0], s.wh[1])).map((s) => `${s.label} ${s.wh ? dims(s.wh) : s.err}`);
        chk(mine.length >= 1 && !wrong.length, "A1", `Screenshots for ${family}: at least one, every one an accepted size (2.3.3)`,
          `${mine.length} found; wrong size: ${JSON.stringify(wrong)}`,
          `Use ${SHOT_SIZES[family].map(dims).join(" or ")} pixels (portrait or landscape) for ${family}; anything else is refused at upload.`);
      }
    });
  }
  const human = cfg.human && typeof cfg.human === "object" ? cfg.human : {};
  if (tablet) add("PASS", "A2", "App declares iPad support and has iPad screenshots (reviewers use iPads)");
  else {
    const ipad = evidence(human.ipad_simulator_tested);
    add(ipad ? "PASS" : "WARN", "A2", "iPhone-only app: run it in the iPad simulator; reviewers use iPads", ipad || "not confirmed",
      "Run the app in an iPad simulator (it opens in iPhone compatibility mode) and fix anything cut off; then send human.ipad_simulator_tested.");
  }
  chk(Boolean(cfg.demo_mode), "A3", "Listing names the demo/sample-data path a reviewer uses with nothing set up (2.1, 4.2.3)", "no demo_mode",
    "Give the reviewer a way in with nothing set up (a demo account in App Review Information, or a sample-data mode), and send demo_mode with its first step.");
  add(cfg.demo_tour ? "PASS" : "WARN", "A4", "A self-playing tour runs the main flow the same way every time (recommended; it makes the screen recording easy)", "no demo_tour",
    "Optional, our practice: add a tour that plays the main flow by itself, so the real-device recording Apple may ask for is one tap.");

  // ---- E. Build configuration ----
  const info = cfg.info_plist && typeof cfg.info_plist === "object" ? cfg.info_plist : null;
  const notesSent = typeof cfg.review_notes === "string";
  const notes = notesSent ? cfg.review_notes : "";
  if (!info) {
    const why = typeof cfg.info_plist === "string" ? `info_plist was a file path (${cfg.info_plist}), not its contents` : "info_plist not sent";
    for (const [c, t] of [["E1", "Export compliance answered in the build"], ["E3", "Every permission prompt says what is used and where it goes (5.1.1(ii))"], ["E4", "No unexplained App Transport Security exception"]]) {
      add("NOT_CHECKED", c, t, why, "Send info_plist (the Info.plist keys as JSON) to check this.");
    }
  } else {
    chk(info.ITSAppUsesNonExemptEncryption === false, "E1", "Export compliance answered in the build (ITSAppUsesNonExemptEncryption = NO)", "missing or not NO",
      "If the app only uses standard HTTPS/system encryption, set ITSAppUsesNonExemptEncryption to NO in Info.plist; otherwise answer export compliance in App Store Connect.");
    const thin = Object.entries(info).filter(([k, v]) => k.endsWith("UsageDescription") && (typeof v !== "string" || v.trim().length < 40)).map(([k]) => k);
    chk(!thin.length, "E3", "Every permission prompt says what is used and where it goes (5.1.1(ii))", `too short: ${JSON.stringify(thin)}`,
      `Rewrite ${thin.join(", ")} as one full sentence: what the app uses, for what, and whether it leaves the device (40+ characters).`);
    const ats = info.NSAppTransportSecurity && typeof info.NSAppTransportSecurity === "object" ? info.NSAppTransportSecurity : {};
    if (ats.NSAllowsArbitraryLoads) {
      if (!notesSent) add("NOT_CHECKED", "E4", "NSAllowsArbitraryLoads is on: review notes explain why (App Transport Security)", "review_notes not sent", "Send review_notes to check this.");
      else chk(notes.toLowerCase().includes("app transport security"), "E4", "NSAllowsArbitraryLoads is on: review notes explain why (App Transport Security)",
        "no 'App Transport Security' paragraph", "Narrow the exception to the domains that need it, or add an 'App Transport Security' paragraph to the review notes saying why.");
    } else add("PASS", "E4", "No blanket App Transport Security exception");
  }
  if (cfg.privacy_manifest === undefined || typeof cfg.privacy_manifest === "string") add("NOT_CHECKED", "E2", "Privacy manifest: tracking off, every required-reason API has a reason",
    typeof cfg.privacy_manifest === "string" ? `privacy_manifest was a file path (${cfg.privacy_manifest}), not its contents` : "privacy_manifest not sent", "Send privacy_manifest (PrivacyInfo.xcprivacy as JSON) to check this.");
  else if (!cfg.privacy_manifest) add("FAIL", "E2", "Privacy manifest present", "no privacy manifest", "Add PrivacyInfo.xcprivacy to the app target; uploads without required-reason declarations get ITMS-91053.");
  else {
    const pm = cfg.privacy_manifest;
    const empty = (Array.isArray(pm.NSPrivacyAccessedAPITypes) ? pm.NSPrivacyAccessedAPITypes : []).filter((a) => !(a?.NSPrivacyAccessedAPITypeReasons?.length)).map((a) => a?.NSPrivacyAccessedAPIType);
    chk(pm.NSPrivacyTracking === false && !empty.length, "E2", "Privacy manifest: tracking off, every required-reason API has a reason",
      `tracking=${pm.NSPrivacyTracking} empty reasons: ${JSON.stringify(empty)}`,
      "Set NSPrivacyTracking to false (unless you track, then declare it) and give every NSPrivacyAccessedAPIType at least one approved reason code.");
  }

  // ---- G. Review notes ----
  if (!notesSent) {
    add("NOT_CHECKED", "G1", "Review notes answer Apple's 2.1 questions before they ask (one heading each)", "review_notes not sent", "Send review_notes (the App Review Information notes) to check this.");
  } else {
    const missing = REVIEW_HEADINGS.filter((h) => !notes.toLowerCase().includes(h.toLowerCase()));
    chk(!missing.length, "G1", "Review notes answer Apple's 2.1 questions before they ask (one heading each)", `missing: ${JSON.stringify(missing)}`,
      `Add a short section for each: ${missing.join("; ")}. These are the questions Apple asks under 2.1 when it is unsure.`);
    hits = wordsIn(notes, ["todo", "tbd", "lorem"]);
    chk(!hits.length, "G2", "Review notes contain no placeholders", hits.join(", "), "Replace the placeholders in the review notes.");
    const rec = notes.match(/screen recording[^\n]*\n([\s\S]*?)(?=\n#|$(?![\s\S]))/i);
    chk(Boolean(rec && /https?:\/\/\S+/.test(rec[1])), "G3", "Review notes link a screen recording made on a real device (2.1)",
      "no link under the 'Screen recording' heading", "Record the main flow on a real device, upload it, and put the link on the line under a 'Screen recording' heading.");
  }

  // ---- C. Public pages ----
  for (const [code, key, text, required] of [["C1", "privacy_policy_url", "Privacy policy page is public and real (5.1.1(i))", true],
    ["C2", "support_url", "Support page is public and has a way to reach you (1.5)", true], ["C3", "marketing_url", "Marketing page is public", false]]) {
    const url = str(L[key]);
    if (!url) { add(required ? "FAIL" : "PASS", code, text, required ? "no URL" : "", required ? `Publish a ${key === "support_url" ? "support page with an email or contact form" : "privacy policy"} and set ${key}.` : ""); continue; }
    pending.push(async () => {
      const r = await fetcher(url);
      const low = r.body.toLowerCase();
      const problems = [];
      if (r.status !== 200) problems.push(`HTTP ${r.status}${r.error ? ` (${r.error})` : ""}`);
      if (["coming soon", "parked", "domain is for sale", "under construction"].some((p) => low.includes(p))) problems.push("placeholder page");
      if (key === "support_url" && !/mailto:|[\w.+-]+@[\w-]+\.[\w.]+|<form/.test(r.body)) problems.push("no email or contact form");
      if (key === "privacy_policy_url") {
        for (const [need, pat] of [["contact", /mailto:|@/], ["retention/deletion", /retain|retention|delet/], ["third parties", /third[- ]part/]]) if (!pat.test(low)) problems.push(`says nothing about ${need}`);
      }
      chk(!problems.length, code, text, `${url}: ` + problems.join("; "),
        key === "privacy_policy_url" ? "Make the page public (HTTP 200, no login) and say how to contact you, how long data is kept and how to delete it, and which third parties get it."
          : key === "support_url" ? "Make the page public and put an email address or contact form on it." : "Make the page public, or leave marketing_url empty.");
    });
  }
  if (req) {
    const url = str(req.get_it_url);
    pending.push(async () => {
      const r = url ? await fetcher(url) : { status: 0, body: "", error: "no get_it_url" };
      const problems = r.status === 200 ? [] : [`answered ${r.status}${r.error ? ` (${r.error})` : ""}`];
      if (/paused|coming soon|not available yet|private build/i.test(r.body)) problems.push("the download is a stub that installs nothing");
      if (url.endsWith(".sh") && r.status === 200 && !r.body.startsWith("#!")) problems.push("not a shell script");
      chk(!problems.length, "C4", `What the app needs (${str(req.what) || "?"}) can be obtained (2.1, 4.2)`, `get_it_url ${url || "(missing)"}: ` + problems.join("; "),
        "Publish a public link where anyone can get what the app needs, and send it as requires.get_it_url. Reviewers can't approve an app they can't make work.");
    });
  }
  // Network checks run together; each adds its own rows. Order of the final list is the gate's order, by code.
  await Promise.all(pending.map((f) => f()));
  const ORDER = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "A1", "A2", "A3", "A4", "E1", "E2", "E3", "E4", "G1", "G2", "G3", "C1", "C2", "C3", "C4"];
  rows.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code)); // stable: same-code rows keep their order

  // ---- Only a person can confirm these ----
  const items = { ...HUMAN_ITEMS, ...(cfg.in_app_purchases ? HUMAN_ITEMS_PAID : {}) };
  if (req) items.requires_installed_clean = "What the app needs was installed from the public link on a clean machine and the app connected to it (2.1)";
  const humanList = Object.entries(items).map(([key, text]) => {
    const v = evidence(human[key]);
    return { key, item: text, confirmed: Boolean(v), evidence: v };
  });
  return { rows, human: humanList, suggestions };
}

function summarize(rows, human) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const c = { pass: count("PASS"), fail: count("FAIL"), warn: count("WARN"), not_checked: count("NOT_CHECKED") };
  const open = human.filter((h) => !h.confirmed).length;
  const verdict = c.fail ? `NOT READY: ${c.fail} check${c.fail === 1 ? "" : "s"} failed`
    : c.not_checked ? `No failures in the ${c.pass + c.warn} checks that ran; ${c.not_checked} not checked (not sent)`
      : `No failures in the ${c.pass + c.warn} checks a machine can run`;
  return { ...c, total: rows.length, people_items_open: open, verdict,
    note: "These are the checks a machine can run on a listing before App Review. Passing them does not mean Apple will approve the app; it means these known reasons for rejection are not in what you sent." };
}

/** The paid output: every row with what was found and the fix, suggestions, and the people checklist. */
export async function check(cfg, opts) {
  const { rows, human, suggestions } = await runChecks(cfg, opts);
  return { product: "will-it-pass", summary: summarize(rows, human), checks: rows, suggestions, people_must_confirm: human };
}

/** The free part: pass or fail per check, no findings or fixes. */
/** Whether the paid part has something to sell: a failure, or a warning other than A4 (our own tour advice). */
export function hasFixes(full) {
  return full.checks.some((r) => r.status === "FAIL" || (r.status === "WARN" && r.code !== "A4"));
}

export function toPreview(full, offer = {}) {
  const fixable = hasFixes(full);
  return {
    summary: full.summary,
    checks: full.checks.map(({ code, status, check, section }) => ({ code, status, check, section })),
    people_must_confirm: full.people_must_confirm.map(({ key, item, confirmed }) => ({ key, item, confirmed })),
    full_version: {
      what: "For each failed or warned check: what was found and the exact fix; trimmed fields and cleaned keywords that fit Apple's limits.",
      available: fixable > 0,
      ...(fixable ? {} : { why_not: "Nothing to fix, so the full version would add nothing; it is refused before payment." }),
      ...offer,
    },
  };
}
