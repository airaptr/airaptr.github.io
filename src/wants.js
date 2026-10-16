// "I want this": a person asks for card checkout before it exists. Kept in our own table (never public);
// the email is optional and only used to tell that person when the card pack opens. Nothing else is stored.
import { TableClient } from "@azure/data-tables";

export const WANTABLE = {
  "will-it-pass": "Will it pass? (10 full listing checks, $5 by card)",
  "rejection-rescue": "Rejection Rescue (10 full rescues, $5 by card)",
};

const conn = (env) => env?.AzureWebJobsStorage || globalThis.process?.env?.AzureWebJobsStorage;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export function parseWant(raw) {
  let body;
  try { body = JSON.parse(raw || "{}"); } catch { return { error: 'Send JSON: {"product": "will-it-pass" | "rejection-rescue", "email": "optional"}.', status: 400 }; }
  const product = String(body.product || "").trim();
  if (!WANTABLE[product]) return { error: `product must be one of: ${Object.keys(WANTABLE).join(", ")}.`, status: 400 };
  const email = String(body.email || "").trim().slice(0, 254);
  if (email && !EMAIL.test(email)) return { error: "That email doesn't look right. Leave it empty if you'd rather not.", status: 400 };
  const note = String(body.note || "").trim().slice(0, 300);
  const source = String(body.source || "api").trim().slice(0, 40);
  return { input: { product, email, note, source } };
}

/** Records the want. Returns what the page should say; `recorded` is false when there is no table to write to. */
export async function recordWant(env, { product, email, note, source }) {
  const c = conn(env);
  let recorded = false;
  if (c && c !== "UseDevelopmentStorage=true") {
    const t = TableClient.fromConnectionString(c, "wants");
    await t.createTable().catch(() => {});
    const at = new Date().toISOString();
    await t.createEntity({ partitionKey: at.slice(0, 10), rowKey: `${at}_${Math.random().toString(36).slice(2, 8)}`, product, email, note, source });
    recorded = true;
  }
  return {
    recorded,
    product,
    message: email
      ? "Noted. You'll get one email when card checkout opens, and nothing else."
      : "Noted. Card checkout opens once a few people ask; check back here.",
  };
}

export async function listWants(env, day) {
  const c = conn(env);
  if (!c) return [];
  const t = TableClient.fromConnectionString(c, "wants");
  const out = [];
  try { for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${day.replace(/'/g, "")}'` } })) out.push({ at: e.rowKey.split("_")[0], product: e.product, email: e.email, note: e.note, source: e.source }); }
  catch (e) { if (e.statusCode !== 404) throw e; }
  return out;
}
