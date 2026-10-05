// Domain Check: agent-first domain names. Checking and pricing are free and keyless
// (public RDAP + Porkbun's public price list). Registration is paid per call over x402 and
// fulfilled through the Wildhaven Porkbun account; it stays off until PORKBUN_API_KEY is set.

const PRICES_URL = "https://api.porkbun.com/api/json/v3/pricing/get";
const RDAP = "https://rdap.org/domain/";
const MARGIN_PCT = 0.1; // our margin on the registrar's price
const MARGIN_FLAT = 2; // plus a flat fee per order, in USD
const MIN_YEARS = { ai: 2 }; // registries with a minimum first term

let priceCache = null;
async function prices() {
  if (priceCache && Date.now() - priceCache.at < 6 * 3600_000) return priceCache.p;
  const r = await fetch(PRICES_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cf: { cacheTtl: 21600 } });
  const d = await r.json();
  if (d.status !== "SUCCESS") throw new Error("price list unavailable");
  priceCache = { at: Date.now(), p: d.pricing };
  return d.pricing;
}

export function normalizeDomain(input) {
  const d = String(input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}

// Registrar prices are strings and use thousands separators ("2,060.25").
export const money = (v) => Number(String(v ?? "").replace(/,/g, ""));

export function quote(registrarPerYear, years) {
  const cost = money(registrarPerYear) * years;
  return Math.round((cost * (1 + MARGIN_PCT) + MARGIN_FLAT) * 100) / 100;
}

// Availability from public registration data, asked of each registry directly via IANA's RDAP
// bootstrap file. 404 = no record = available to register.
const UA = { "User-Agent": "raptr-domains/1.0 (+https://airaptr.github.io/)", accept: "application/rdap+json" };
let bootstrap = null;
async function rdapBase(tld) {
  if (!bootstrap || Date.now() - bootstrap.at > 24 * 3600_000) {
    const d = await (await fetch("https://data.iana.org/rdap/dns.json", { headers: UA, cf: { cacheTtl: 86400 } })).json();
    const map = {};
    for (const [tlds, urls] of d.services) for (const t of tlds) map[t] = urls.find((u) => u.startsWith("https")) || urls[0];
    bootstrap = { at: Date.now(), map };
  }
  return bootstrap.map[tld];
}

async function rdapStatus(domain) {
  try {
    const tld = domain.split(".").pop();
    const base = (await rdapBase(tld)) || "https://rdap.org/";
    const r = await fetch(`${base.replace(/\/?$/, "/")}domain/${domain}`, { redirect: "follow", headers: UA });
    if (r.status === 404) return "available";
    if (r.ok) return "taken";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function checkDomains({ domains }) {
  const list = [...new Set((domains || []).map(normalizeDomain).filter(Boolean))].slice(0, 20);
  if (!list.length) return { text: "Give one or more full domain names, like getrapp.ai or myshop.com.", structured: { results: [] }, isError: true };
  const p = await prices();
  const results = await Promise.all(list.map(async (domain) => {
    const tld = domain.split(".").slice(1).join(".");
    const price = p[tld] || p[domain.split(".").pop()];
    const years = MIN_YEARS[tld] || 1;
    const status = await rdapStatus(domain);
    return {
      domain,
      status,
      years,
      price_usd: price ? quote(price.registration, years) : null,
      renewal_per_year_usd: price ? Math.round(money(price.renewal) * (1 + MARGIN_PCT) * 100) / 100 : null,
      supported: !!price,
    };
  }));
  const line = (x) => x.status === "available"
    ? `${x.domain}: available, $${x.price_usd} for ${x.years} year${x.years > 1 ? "s" : ""} (renews at $${x.renewal_per_year_usd}/year)`
    : x.status === "taken" ? `${x.domain}: taken` : `${x.domain}: couldn't confirm, try again`;
  return {
    text: results.map(line).join("\n") + "\n\nTo buy one, use register_domain.",
    structured: { results },
  };
}

export function registerInfo({ domain }, site) {
  const d = normalizeDomain(domain);
  return {
    text:
      `To register ${d || "a domain"}:\n` +
      `- AI agents: pay per call over x402 at POST https://airaptr-api.azurewebsites.net/x402/domains/register with {"domain":"${d || "example.com"}"}. ` +
      `The 402 response states the exact price in USDC; the domain is registered only after payment, and you are charged only if registration succeeds. ` +
      `x402 clients cap each payment at $1 by default, so raise your client's per-payment limit to cover the quoted price.\n` +
      `- People: ask at ${site}contact.html and we'll register it for you.`,
    structured: { domain: d, agent_endpoint: "/x402/domains/register", contact: `${site}contact.html` },
  };
}

// --- Fulfilment through Porkbun (paid path). Off until keys are set.
// Sandbox keys (pk1_sb_) only ever touch Porkbun's sandbox. Live keys refuse to buy unless PORKBUN_LIVE=1.
function porkbunConfig(env = {}) {
  const get = (k) => env[k] || globalThis.process?.env?.[k];
  const key = get("PORKBUN_API_KEY");
  return { key, secret: get("PORKBUN_SECRET_KEY"), sandbox: !!key && key.startsWith("pk1_sb_"), live: get("PORKBUN_LIVE") === "1", base: get("PORKBUN_BASE") || "https://api.porkbun.com/api/json/v3" };
}

export function fulfilmentReady(env) {
  return !!porkbunConfig(env).key;
}

async function porkbun(c, path, extra = {}) {
  const res = await fetch(`${c.base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apikey: c.key, secretapikey: c.secret, ...extra }) });
  const body = await res.json().catch(() => ({}));
  if (body.status !== "SUCCESS") throw new Error(body.message || `registrar returned ${res.status}`);
  return body;
}

// The registrar's own quote: availability, premium status, minimum term and the exact cost we will pay.
async function registrarQuote(c, domain) {
  const q = (await porkbun(c, `/domain/checkDomain/${domain}`)).response;
  if (q.avail !== "yes") throw new Error(`${domain} is not available`);
  if (q.premium === "yes") throw new Error(`${domain} is a premium domain, not sold through this service yet`);
  const years = Number(q.minDuration) || 1;
  return { years, cost_cents: Math.round(money(q.price) * years * 100), per_year: money(q.price) };
}

export async function orderQuote(domain, env = {}) {
  const d = normalizeDomain(domain);
  if (!d) throw new Error("invalid domain");
  const [r] = (await checkDomains({ domains: [d] })).structured.results;
  if (r.status !== "available") throw new Error(`${d} is ${r.status}`);
  if (!r.price_usd) throw new Error(`.${d.split(".").pop()} is not supported`);
  // When the registrar is connected, its live quote is authoritative (catches premium and price changes).
  const c = porkbunConfig(env);
  if (c.key) {
    const rq = await registrarQuote(c, d);
    return { ...r, years: rq.years, price_usd: quote(rq.per_year, rq.years) };
  }
  return r;
}

export async function registerAtPorkbun(env, domain) {
  const c = porkbunConfig(env);
  if (!c.sandbox && !c.live) throw new Error("live registration is switched off");
  const rq = await registrarQuote(c, domain);
  const body = await porkbun(c, `/domain/create/${domain}`, { cost: rq.cost_cents, agreeToTerms: "yes" });
  return { domain, years: rq.years, registrar: "porkbun", sandbox: !!body.sandbox, registrar_cost_usd: rq.cost_cents / 100, order_id: body.orderId || body.order_id || null };
}

// --- Business names: check candidate names across the domain endings that matter, plus the GitHub handle.
const DEFAULT_ENDINGS = ["com", "co", "ai", "io", "app"];
export const slugify = (n) => String(n || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9-]+/g, "").replace(/^-+|-+$/g, "").slice(0, 63);

async function githubFree(slug) {
  try {
    const r = await fetch(`https://api.github.com/users/${slug}`, { headers: { "User-Agent": "raptr-names", accept: "application/vnd.github+json" } });
    if (r.status === 404) return "free";
    if (r.ok) return "taken";
  } catch {}
  return "unknown";
}

export async function checkNames({ names, endings }) {
  const slugs = [...new Set((names || []).map(slugify).filter((s) => s.length >= 2))].slice(0, 8);
  const ends = [...new Set((endings?.length ? endings : DEFAULT_ENDINGS).map((e) => String(e).replace(/^\./, "").toLowerCase()))].slice(0, 5);
  if (!slugs.length) return { text: "Give one or more candidate names, like ['Northwind Bakery', 'Rise & Crumb'].", structured: { results: [] }, isError: true };
  const domains = slugs.flatMap((s) => ends.map((e) => `${s}.${e}`)).slice(0, 40);
  const checked = [];
  for (let i = 0; i < domains.length; i += 20) checked.push(...(await checkDomains({ domains: domains.slice(i, i + 20) })).structured.results);
  const gh = Object.fromEntries(await Promise.all(slugs.map(async (s) => [s, await githubFree(s)])));
  const results = slugs.map((s) => {
    const mine = checked.filter((r) => r.domain.startsWith(s + "."));
    const free = mine.filter((r) => r.status === "available");
    return { name: s, free_domains: free.map((r) => ({ domain: r.domain, price_usd: r.price_usd, years: r.years })), taken: mine.filter((r) => r.status === "taken").map((r) => r.domain), github: gh[s], score: free.length + (gh[s] === "free" ? 1 : 0) + (free.some((r) => r.domain.endsWith(".com")) ? 2 : 0) };
  }).sort((a, b) => b.score - a.score);
  const line = (r) => `${r.name}: ${r.free_domains.length ? r.free_domains.map((f) => `${f.domain} $${f.price_usd}`).join(", ") : "no free domains among those checked"}${r.github === "free" ? " · GitHub name free" : r.github === "taken" ? " · GitHub name taken" : ""}`;
  return { text: "Best first (a free .com counts most):\n" + results.map(line).join("\n") + "\n\nTo buy a domain, use register_domain.", structured: { results } };
}
