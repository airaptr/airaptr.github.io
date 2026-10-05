// Business Kit: the tools from our guides, as one free MCP server we use ourselves.
// Read-only and deterministic: nothing is fetched, nothing is stored.

const GUMROAD = "https://airaptr.gumroad.com";
const usd = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2);

// ---------- burn_rate (The Bootstrap Protocol) ----------
export function burnRate({ costs = [], cap = 100, hours_per_day } = {}) {
  const rows = costs
    .filter((c) => c && typeof c.item === "string" && Number.isFinite(Number(c.monthly)))
    .map((c) => ({ item: c.item.slice(0, 80), monthly: Math.max(0, Number(c.monthly)), always_on: c.always_on !== false }));
  if (!rows.length) return { text: "Give me your monthly costs as a list of {item, monthly} (US dollars).", isError: true };
  const total = rows.reduce((s, r) => s + r.monthly, 0);
  const alwaysOn = rows.filter((r) => r.always_on).reduce((s, r) => s + r.monthly, 0);
  const sleepy = Number.isFinite(Number(hours_per_day)) ? total - alwaysOn * (1 - Math.min(24, Math.max(0, hours_per_day)) / 24) : null;
  const sorted = [...rows].sort((a, b) => b.monthly - a.monthly);
  const verdict = total <= cap ? "UNDER THE CAP" : "OVER THE CAP";
  const cuts = [];
  if (total > cap || sorted[0].monthly > total * 0.4) cuts.push(`Look at ${sorted[0].item} first: ${usd(sorted[0].monthly)}, ${Math.round((sorted[0].monthly / total) * 100)}% of the bill.`);
  if (alwaysOn > 0 && sleepy === null) cuts.push("Servers that sleep when nobody uses them cost less: pass hours_per_day to see the difference.");
  cuts.push("Every paid service should earn its keep within 3 months, or it goes.");
  const lines = sorted.map((r) => `- ${r.item}: ${usd(r.monthly)}${r.always_on ? "" : " (usage-based)"}`);
  const text =
    `${verdict}: ${usd(total)} a month against a ${usd(cap)} cap (${usd(total / 30)} a day).\n` +
    (sleepy !== null ? `Running servers ${hours_per_day} hours a day instead: about ${usd(sleepy)} a month.\n` : "") +
    `\n${lines.join("\n")}\n\nNext:\n- ${cuts.join("\n- ")}\n\nThe full rulebook and the weekly audit: The Bootstrap Protocol Kit, ${GUMROAD}/l/bootstrap-protocol`;
  return { text, structured: { total: +total.toFixed(2), cap, under_cap: total <= cap, per_day: +(total / 30).toFixed(2), if_sleeping: sleepy === null ? null : +sleepy.toFixed(2), largest: sorted[0].item } };
}

// ---------- find_outliers (Find What's Trending) ----------
export function findOutliers({ videos = [], min_like_ratio = 1, min_view_ratio = 3 } = {}) {
  const rows = videos
    .filter((v) => v && v.title && Number(v.subscribers) > 0)
    .map((v) => {
      const subs = Number(v.subscribers), likes = Number(v.likes) || 0, views = Number(v.views) || 0;
      return { title: String(v.title).slice(0, 140), channel: v.channel ? String(v.channel).slice(0, 60) : "", url: v.url || "", subscribers: subs, likes, views,
               like_ratio: +(likes / subs).toFixed(2), view_ratio: +(views / subs).toFixed(2) };
    });
  if (!rows.length) return { text: "Give me videos as {title, subscribers, likes, views} (channel and url optional). Subscribers must be above zero.", isError: true };
  const hits = rows.filter((r) => r.like_ratio >= min_like_ratio || r.view_ratio >= min_view_ratio)
    .sort((a, b) => b.like_ratio - a.like_ratio || b.view_ratio - a.view_ratio);
  const fmt = (r) => `- ${r.title}${r.channel ? " (" + r.channel + ")" : ""}: ${r.like_ratio}x likes per subscriber, ${r.view_ratio}x views per subscriber${r.url ? " " + r.url : ""}`;
  const text = hits.length
    ? `${hits.length} of ${rows.length} videos beat their own channel (the signal: more likes than the channel has subscribers, or ${min_view_ratio}x the views):\n${hits.map(fmt).join("\n")}\n\nNext: look for the pattern they share (topic, title shape, format), then make your own take, with credit. The full Monday routine: ${GUMROAD}`
    : `None of the ${rows.length} videos beat their channel yet. Try newer uploads from smaller channels; the signal shows up most there.`;
  return { text, structured: { checked: rows.length, outliers: hits } };
}

// ---------- content_seeds (The Perpetual Content Machine) ----------
const KINDS = [
  ["lesson", /\b(fix|fixed|bug|broke|failed|blocked|lesson|gotcha|wrong|mistake|quarantine|guard)\b/i],
  ["milestone", /\b(live|public|publish|published|launch|launched|shipped|released|rendered|first)\b|\b\d+\.\d+\.\d+\b/i],
  ["number", /\$\d|\d+%|\d+\/\d+|\btokens?\b|\bper month\b|\bviews?\b|\bsales?\b/i],
  ["product", /\b(product|kit|guide|course|offer|gumroad|price|pricing)\b/i],
];
const USE = {
  milestone: "a short (\"we just shipped…\") and a newsletter headline",
  lesson: "a \"mistakes and fixes\" short and a course lesson",
  number: "a short built around the number, and a line in the monthly numbers post",
  product: "a product page update and a walkthrough video",
  build: "a build-log line; group several into one short",
};
export function contentSeeds({ work = [] } = {}) {
  const items = (Array.isArray(work) ? work : String(work).split("\n")).map((w) => String(w).trim()).filter(Boolean).slice(0, 100);
  if (!items.length) return { text: "Paste what you worked on: one line per thing you did (commit messages work).", isError: true };
  const seeds = items.map((w) => ({ work: w.slice(0, 200), kind: (KINDS.find(([, re]) => re.test(w)) || ["build"])[0] }));
  const order = ["milestone", "lesson", "number", "product", "build"];
  const groups = order.map((k) => [k, seeds.filter((s) => s.kind === k)]).filter(([, v]) => v.length);
  const text = groups.map(([k, v]) => `${k.toUpperCase()} (${v.length}) → ${USE[k]}\n${v.map((s) => "- " + s.work).join("\n")}`).join("\n\n") +
    `\n\nPick the top milestone and the top lesson: that's tomorrow's two shorts. Capture this automatically after every work session: ${GUMROAD}/l/content-machine`;
  return { text, structured: { seeds, counts: Object.fromEntries(groups.map(([k, v]) => [k, v.length])) } };
}

// ---------- setup_checklist (AI Business Stack Setup) ----------
const STEPS = [
  ["account", "One business email for the company (not your personal one)", "10 min"],
  ["youtube", "YouTube channel: name, handle, logo, banner, one-line description", "30 min"],
  ["newsletter", "Newsletter (Beehiiv): publication, logo, welcome email", "30 min"],
  ["store", "Store (Gumroad): profile, payout method, first product", "30 min"],
  ["first_short", "First short uploaded and public", "1 hr"],
  ["first_issue", "First newsletter issue written and sent", "1 hr"],
  ["first_product", "First product live, link in the channel and the newsletter", "1 hr"],
];
export function setupChecklist({ done = [] } = {}) {
  const have = new Set((Array.isArray(done) ? done : []).map((d) => String(d).toLowerCase()));
  const left = STEPS.filter(([k]) => !have.has(k));
  const pct = Math.round(((STEPS.length - left.length) / STEPS.length) * 100);
  const text = left.length
    ? `${pct}% set up. Next, in order:\n${left.map(([k, s, t]) => `- [${k}] ${s} (${t})`).join("\n")}\n\nYou do only the sign-ins and anything with money; let your AI do the rest. Step by step with screenshots: ${GUMROAD}/l/ai-business-stack-setup`
    : "All set up. Next: keep a daily posting rhythm and log your numbers once a week.";
  return { text, structured: { percent: pct, remaining: left.map(([k, s, t]) => ({ key: k, step: s, time: t })), keys: STEPS.map(([k]) => k) } };
}
