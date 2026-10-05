// Explicit demand signals: when a person asks for something we don't offer yet and chooses to pass the request on.
// Only what they chose to send is stored, with no identity. Usage counts stay content-free; this is the opt-in channel.
import { TableClient } from "@azure/data-tables";

const conn = (env) => env?.AzureWebJobsStorage || globalThis.process?.env?.AzureWebJobsStorage;

export async function recordRequest(env, { request, listing }) {
  const text = String(request || "").trim().slice(0, 500);
  if (text.length < 5) return { text: "Say in a sentence what you'd like us to build.", structured: { recorded: false }, isError: true };
  const c = conn(env);
  if (c && c !== "UseDevelopmentStorage=true") {
    const t = TableClient.fromConnectionString(c, "signals");
    await t.createTable().catch(() => {});
    const at = new Date().toISOString();
    await t.createEntity({ partitionKey: at.slice(0, 10), rowKey: `${at}_${Math.random().toString(36).slice(2, 8)}`, request: text, listing });
  }
  return { text: "Passed on. Thanks, this is how we decide what to build next.", structured: { recorded: true } };
}

export async function listRequests(env, day) {
  const c = conn(env);
  if (!c) return [];
  const t = TableClient.fromConnectionString(c, "signals");
  const out = [];
  try { for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${day.replace(/'/g, "")}'` } })) out.push({ at: e.rowKey.split("_")[0], listing: e.listing, request: e.request }); }
  catch (e) { if (e.statusCode !== 404) throw e; }
  return out;
}
