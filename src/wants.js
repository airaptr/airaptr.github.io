// "I want this": a person asks for card checkout before it exists. Kept in our own table (never public);
// the email is optional and only used to tell that person once when the card pack opens. Nothing else is
// stored, and nothing a caller typed reaches the log: only the product and a yes/no for the email.
import { TableClient } from "@azure/data-tables";

export const WANTABLE = {
  "will-it-pass": "Will it pass? (10 full listing checks, $5 by card)",
  "rejection-rescue": "Rejection Rescue (10 full rescues, $5 by card)",
};
export const SOURCES = ["people-page", "api"];
export const MAX_BODY = 2048;
export const PER_IP_PER_HOUR = 5;
/** Emails are kept this long at most; the one message, or this, deletes them. */
export const KEEP_DAYS = 90;

const conn = (env) => env?.AzureWebJobsStorage || globalThis.process?.env?.AzureWebJobsStorage;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

/** Body size is checked before parsing, so a large body costs one length test and nothing else. */
export function parseWant(raw) {
  if (typeof raw !== "string" || raw.length > MAX_BODY) return { error: `Body too large (max ${MAX_BODY} bytes).`, status: 413 };
  let body;
  try { body = JSON.parse(raw || "{}"); } catch { return { error: 'Send JSON: {"product": "will-it-pass" | "rejection-rescue", "email": "optional"}.', status: 400 }; }
  if (!body || typeof body !== "object") return { error: "Send a JSON object.", status: 400 };
  const product = String(body.product || "").trim();
  if (!WANTABLE[product]) return { error: `product must be one of: ${Object.keys(WANTABLE).join(", ")}.`, status: 400 };
  const email = String(body.email || "").trim();
  if (email && (email.length > 254 || !EMAIL.test(email))) return { error: "That email doesn't look right. Leave it empty if you'd rather not.", status: 400 };
  const source = SOURCES.includes(body.source) ? body.source : "api";
  return { input: { product, email, source } };
}

// Best-effort throttle per caller address, per running instance. It stops a loop, not a determined
// attacker; the table is ours and the watcher caps its own messages, so the blast radius is small.
const recent = new Map();
export function throttled(ip, now = Date.now()) {
  const key = String(ip || "unknown");
  const hits = (recent.get(key) || []).filter((t) => now - t < 3_600_000);
  if (hits.length >= PER_IP_PER_HOUR) return true;
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) recent.delete(recent.keys().next().value);
  return false;
}

/** Records the want. `recorded` is false when there is no table to write to; the page must say so. */
export async function recordWant(env, { product, email, source }) {
  const c = conn(env);
  let recorded = false;
  if (c && c !== "UseDevelopmentStorage=true") {
    const t = TableClient.fromConnectionString(c, "wants");
    await t.createTable().catch(() => {});
    const at = new Date().toISOString();
    const deleteAfter = new Date(Date.now() + KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    await t.createEntity({ partitionKey: at.slice(0, 10), rowKey: `${at}_${Math.random().toString(36).slice(2, 8)}`, product, email, source, deleteAfter });
    recorded = true;
  }
  const message = !recorded
    ? "We couldn't save that just now. Please try again in a minute, or email us from the Contact page."
    : email
      ? `Noted. You'll get one email when card checkout opens, and nothing else; we delete the address after that, or after ${KEEP_DAYS} days.`
      : "Noted. Card checkout opens once a few people ask; check back here.";
  return { recorded, product, message };
}

export async function listWants(env, day) {
  const c = conn(env);
  if (!c) return [];
  const t = TableClient.fromConnectionString(c, "wants");
  const out = [];
  try { for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${day.replace(/'/g, "")}'` } })) out.push({ at: e.rowKey.split("_")[0], product: e.product, email: e.email, source: e.source, deleteAfter: e.deleteAfter }); }
  catch (e) { if (e.statusCode !== 404) throw e; }
  return out;
}
