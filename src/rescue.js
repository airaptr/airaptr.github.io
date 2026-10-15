// Rejection Rescue: Apple's App Review rejection text in, a diagnosis, fix list and reply draft out.
// A port of rapple-factory/rescue/rescue.py (server side: no app repo, so no gate or rapple-review evidence).
// The playbook (src/playbook.json) is a copy of rapple-factory/rescue/playbook.json; keep the two in step.
//
// Free: preview() names the guideline sections it recognizes and what Apple means by each.
// Paid (POST /x402/rescue): rescue() returns the full diagnosis, fix cards and the reply draft.

import PLAYBOOK from "./playbook.json" with { type: "json" };

export const BOOK = PLAYBOOK.sections;
export const MAX_INPUT_BYTES = 20 * 1024;

// Python's re with str patterns: \d is any Unicode digit and [a-z] with re.I folds case; the u flag gives the same.
const SECTION = /Guideline\s+(\p{Nd}+(?:\.\p{Nd}+){0,3})(\([a-z]+\))?/giu;
// Python str.splitlines() and str.strip() character sets, so lines and questions come out the same.
const LINES = /\r\n|[\n\v\f\r\x1c-\x1e\x85\u2028\u2029]/;
const PY_SPACE = new Set([..."\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0\u1680\u2028\u2029\u202f\u205f\u3000"].concat(Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x2000 + i))));
function pyStrip(s) { // linear, unlike a /\s+$/-style regex on long runs of spaces
  let a = 0, b = s.length;
  while (a < b && PY_SPACE.has(s[a])) a++;
  while (b > a && PY_SPACE.has(s[b - 1])) b--;
  return s.slice(a, b);
}
const replaceAll = (s, a, b) => s.split(a).join(b); // literal, no $-patterns

/** Sections in the order Apple cites them, de-duplicated, keeping the sub-letter: ["2.1", "5.1.1(i)", ...]. */
export function cited(text) {
  const out = [];
  for (const m of String(text).matchAll(SECTION)) {
    const s = m[1] + (m[2] || "").toLowerCase();
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** The most specific playbook entry: 5.1.1(v) → 5.1.1; 2.3.3 → 2.3.3; 2.3.7 → 2.3; 9.9 → [null, null]. */
export function entryFor(section, book = BOOK) {
  const parts = section.split("(")[0].split(".");
  while (parts.length) {
    const key = parts.join(".");
    if (Object.hasOwn(book, key)) return [key, book[key]];
    parts.pop();
  }
  return [null, null];
}

/** Apple's numbered asks and direct questions, so the reply answers each one under its own heading. */
export function questions(text) {
  const qs = [];
  for (const line of String(text).split(LINES)) {
    const s = pyStrip(line);
    const m = s.match(/^(\p{Nd}+)[.)]\s+(.*)/u) || s.match(/^[-•]\s+(.*)/u);
    if (m) qs.push(pyStrip(m[m.length - 1]));
    else if (s.endsWith("?") && [...s].length > 15) qs.push(s);
  }
  return qs;
}

/** The full rescue (the paid output). changes / recording_url fill the reply's placeholders when given. */
export function rescue(text, { changes = "", recording_url = "" } = {}) {
  const sections = cited(text);
  const asks = questions(text);
  const items = [], unknown = [], cards = [], replyParts = [];
  for (const s of sections) {
    const [key, e] = entryFor(s);
    if (!e) { unknown.push(s); continue; }
    items.push({ section: s, playbook: key, title: e.title, means: e.means, likely_causes: e.causes, check: e.checks, evidence: [], fix: e.fix });
    for (const step of e.fix) cards.push(`[${s}] ${step}`);
    replyParts.push(e.reply);
  }
  const answers = asks.map((q, i) => `${i + 1}. ${q}\n   → [answer]`).join("\n") || "[answer each point Apple raised]";
  let reply = [...new Set(replyParts)].join("\n\n"); // same template twice (e.g. 5.1.1 and 5.1.2) → once
  reply = replaceAll(reply, "{answers}", answers);
  reply = replaceAll(reply, "{changes}", changes || "[list exactly what changed]");
  reply = replaceAll(reply, "{recording_url}", recording_url || "[link the real-device recording]");
  reply = replaceAll(reply, "{s}", "s");
  const missing = [
    reply.includes("[answer") ? "answers to Apple's questions" : null,
    reply.includes("[list exactly") ? "the list of changes" : null,
    reply.includes("[link the") ? "the recording link" : null,
  ].filter(Boolean);
  return {
    sections, items, unknown_sections: unknown, apple_asked: asks, cards,
    reply_draft: reply, reply_ready: missing.length === 0, reply_missing: missing,
  };
}

/** The free part: which sections it recognizes and what Apple means by each. */
export function preview(text, offer = {}) {
  const sections = cited(text);
  const recognized = [], unknown = [];
  for (const s of sections) {
    const [key, e] = entryFor(s);
    if (e) recognized.push({ section: s, playbook: key, title: e.title, means: e.means });
    else unknown.push(s);
  }
  return {
    sections,
    recognized,
    unknown_sections: unknown,
    apple_asked_count: questions(text).length,
    full_version: {
      what: "Likely causes, a fix list per section, and a reply draft to App Review that answers each of Apple's numbered questions.",
      available: recognized.length > 0,
      ...offer,
    },
  };
}

// ---------- receipts: sha256 of the canonical JSON body ----------

/** Keys sorted at every level, no whitespace (Python: json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)). */
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

export const RECEIPT_NOTE = "sha256 is the SHA-256 (hex) of this object without the sha256 and sha256_of fields, as canonical JSON: keys sorted at every level, no whitespace, UTF-8.";

export async function withReceipt(body) {
  const bytes = new TextEncoder().encode(canonical(body));
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ...body, sha256: hex, sha256_of: RECEIPT_NOTE };
}

// ---------- input: the same checks for the preview and the paid route, all before any payment ----------

/** Parse a request body (JSON {text, changes?, recording_url?}, or plain text) into input or an error with its status. */
export function parseInput(raw, contentType = "") {
  const size = new TextEncoder().encode(raw).length;
  if (size > MAX_INPUT_BYTES) return { status: 413, error: `Input is ${size} bytes; the limit is ${MAX_INPUT_BYTES} bytes (20 KB). Send only Apple's rejection message.` };
  let input;
  if (/json/i.test(contentType) || /^\s*\{/.test(raw)) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { status: 400, error: 'Body is not valid JSON. Send {"text": "<Apple\'s rejection message>"}.' }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: 400, error: 'Body must be a JSON object: {"text": "...", "changes": "...", "recording_url": "..."}.' };
    for (const k of ["text", "changes", "recording_url"]) {
      if (parsed[k] !== undefined && parsed[k] !== null && typeof parsed[k] !== "string") return { status: 400, error: `"${k}" must be a string.` };
    }
    input = { text: parsed.text || "", changes: parsed.changes || "", recording_url: parsed.recording_url || "" };
  } else {
    input = { text: raw, changes: "", recording_url: "" };
  }
  if (!input.text.trim()) return { status: 400, error: 'Empty input. Send {"text": "<Apple\'s rejection message>"}.' };
  return { input };
}
