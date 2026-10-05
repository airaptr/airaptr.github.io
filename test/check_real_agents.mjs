// Stored test: the checker must reject the raw template and accept real registry agents.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { checkAgent, searchAgents } from "../src/index.js";

const RAR = process.argv[2] || "../RAR";
const tpl = checkAgent("template_agent.py", readFileSync(join(RAR, "template_agent.py"), "utf8"));
console.log("template rejected:", !tpl.passed, "-", tpl.problems.length, "problems");
if (tpl.passed) process.exitCode = 1;

const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : f.endsWith("_agent.py") && files.push(p); } })(join(RAR, "agents"));
const fails = {};
let pass = 0;
for (const f of files) {
  const r = checkAgent(basename(f), readFileSync(f, "utf8"));
  if (r.passed) pass++; else for (const p of r.problems) { const k = p.replace(/"[^"]*"/g, '"…"'); (fails[k] ||= []).push(f); }
}
console.log(`registry agents passing: ${pass}/${files.length}`);
for (const [k, v] of Object.entries(fails).sort((a, b) => b[1].length - a[1].length)) console.log(`${v.length}\t${k}\t e.g. ${v[0]}`);

const reg = JSON.parse(readFileSync(join(RAR, "registry.json"), "utf8")).agents.map(a => ({ ...a, tags: a.tags || [] }));
for (const q of ["summarize sales calls", "invoice", "weather"]) console.log(q, "→", searchAgents(reg, q, 3).map(a => a.name).join(", "));
