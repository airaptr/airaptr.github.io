// Raptr Agent Builder — a ChatGPT app (MCP server over streamable HTTP, stateless JSON responses).
// ChatGPT's own model writes the agent; this server supplies the template, checks the result,
// searches the public RAR registry, and tells the user how to run it in their own Brainstem.

import { TEMPLATE } from "./template.js";

// The paid agent API (x402) loads its libraries only when a paid route is hit.
const PAID_PREFIX = "/x402/";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const REGISTRY_URL = "https://kody-w.github.io/RAR/registry.json";
const RAW_BASE = "https://raw.githubusercontent.com/kody-w/RAR/main/";
const SITE = "https://airaptr.github.io/";

const CATEGORIES = [
  "core", "pipeline", "integrations", "productivity", "devtools", "b2b_sales", "b2c_sales",
  "energy", "federal_government", "financial_services", "general", "healthcare",
  "human_resources", "it_management", "manufacturing", "professional_services", "retail_cpg",
  "slg_government", "software_digital_products",
];

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const TOOLS = [
  {
    name: "get_agent_template",
    title: "Get the agent template",
    description:
      "Use this when the user wants to build an AI agent, assistant, bot or automation from an idea, a repetitive task, a process description, " +
      "or a meeting transcript (for example: automate invoices, triage support tickets, summarize meetings, follow up with leads). " +
      "Returns the official single-file agent template and its rules. Fill it in yourself from what the user described, " +
      "then call check_agent on the finished file before showing it to the user. Then call use_agent_here so the user can use it right away in this chat.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "check_agent",
    title: "Check an agent file",
    description:
      "Checks a finished agent file against the template rules (manifest, naming, class, perform method, no hardcoded secrets). " +
      "Call it on every agent you write, fix anything it reports, and call it again until it passes.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "File name, must end with _agent.py, e.g. invoice_triage_agent.py" },
        code: { type: "string", description: "The full Python source of the agent file" },
      },
      required: ["filename", "code"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "find_agents",
    title: "Find existing agents",
    description:
      "Searches the open agent registry (RAR) (RAR, about 1,700 single-file agents) for agents that already do what the user wants, " +
      "for example when they ask 'is there an AI tool for...' or want a ready-made automation instead of building one. " +
      "Use it before building from scratch, or when the user asks whether an agent exists for a task.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Plain words describing the task, e.g. 'summarize sales calls'" },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "How many results, default 5" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: "get_agent_code",
    title: "Get an agent's code",
    description: "Returns the full source of one agent from the registry, by its name (e.g. @bill/neuron_agent), so it can be read or adapted.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Registry name, e.g. @kody/memory_agent" } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: "use_agent_here",
    title: "Use the agent in this chat",
    description:
      "Use this right after an agent passes check_agent, or whenever the user wants to try an agent. Returns a short Python runner so you can run the agent " +
      "in this chat with your own Python tool on the user's own data (pasted text, an uploaded spreadsheet, a list). Nothing to install. If Python is unavailable, " +
      "apply the agent's logic yourself by reading its code. " +
      "Ask the user for their real data, run the agent, and show the result in plain words.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "The agent file name, e.g. invoice_triage_agent.py" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "how_to_run_agent",
    title: "Keep an agent running on your computer",
    description: "Optional, for later: how to keep an agent running on the user's own computer with the free Brainstem. Only offer this after the user has used the agent in the chat and wants to keep it.",
    inputSchema: {
      type: "object",
      properties: {
        os: { type: "string", enum: ["mac", "windows", "linux"], description: "The user's operating system" },
        filename: { type: "string", description: "The agent file name, if known" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "share_agent",
    title: "Share an agent with everyone",
    description:
      "Use only when the user says they want to share an agent they built. Checks the agent and scans it for personal details " +
      "(emails, phone numbers, secrets), then explains how to publish it to the free open agent registry (RAR) under their own GitHub account. " +
      "Nothing is published by this tool.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Agent file name, ending in _agent.py" },
        code: { type: "string", description: "The full Python source of the agent" },
      },
      required: ["filename", "code"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "world_now",
    title: "Verified snapshot of the world right now",
    description:
      "Use when the user asks what is happening in the world right now and wants numbers they can trust and cite: Bitcoin and crypto market, " +
      "currency exchange rates, earthquakes in the past hour, space weather, where the International Space Station is, and more. " +
      "Every snapshot carries its public tick number, time and SHA-256 fingerprint so anyone can check it later.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: "fingerprint_text",
    title: "Fingerprint a piece of text",
    description:
      "Use when the user wants to know whether two texts are exactly identical, or wants a fingerprint to compare a document against later. " +
      "Returns the SHA-256 fingerprint of the exact text, and whether it matches an expected fingerprint if one is given. " +
      "It does not store the text or prove when it was written.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The exact text to fingerprint" },
        expected: { type: "string", description: "Optional fingerprint (64 hex characters) to compare against" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "check_domain",
    title: "Check and price domain names",
    description:
      "Use when the user wants a domain name, is naming a business or project, or asks whether a domain is taken. Checks up to 20 full domain names " +
      "(you can suggest variations and check them together) and returns whether each is available and its price.",
    inputSchema: {
      type: "object",
      properties: { domains: { type: "array", items: { type: "string" }, maxItems: 20, description: "Full domain names, e.g. [\"getrapp.ai\", \"getrapp.com\"]" } },
      required: ["domains"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: "check_names",
    title: "Check business names",
    description:
      "Use when someone is naming a business, startup, product, brand, app, side hustle, shop, podcast or project. Brainstorm candidate names first, " +
      "then check up to 8 at once: for each, which domains (.com, .co, .ai, .io, .app by default) are free with prices, and whether the GitHub name is free. " +
      "Results are ranked, a free .com counts most. Suggest new candidates and check again if the best ones are taken.",
    inputSchema: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, maxItems: 8, description: "Candidate names, e.g. [\"Rise and Crumb\", \"Northwind Bakery\"]" },
        endings: { type: "array", items: { type: "string" }, maxItems: 5, description: "Optional domain endings to check, e.g. [\"com\", \"shop\"]" },
      },
      required: ["names"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: "register_domain",
    title: "How to register a domain",
    description: "Use when the user wants to buy an available domain. Explains how to register it: AI agents pay per call; people ask us and we register it for them. Nothing is bought by this tool.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", description: "The domain to register" } },
      required: ["domain"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "request_service",
    title: "Ask us to build something",
    description:
      "Use when the person wants something none of these tools can do and says yes to passing the request on. Records only the request text " +
      "they agree to send (no name or contact). Ask before calling it.",
    inputSchema: {
      type: "object",
      properties: { request: { type: "string", description: "What they want, in a sentence, as they agreed to send it" } },
      required: ["request"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

// Each ChatGPT listing is the same server with its own set of tools.
const PROFILES = {
  builder: {
    server: { name: "raptr-agent-builder", version: "1.2.0" },
    tools: ["get_agent_template", "check_agent", "use_agent_here", "find_agents", "get_agent_code", "share_agent", "how_to_run_agent", "request_service"],
    instructions:
      "Build single-file AI agents people can use immediately: get_agent_template, write the agent, check_agent until it passes, then use_agent_here " +
      "to run it in this chat on the user's own data. Nothing to install. Use find_agents to reuse existing ones. how_to_run_agent is only for keeping " +
      "an agent on their own computer later. share_agent only when the user asks to share.",
  },
  finder: {
    server: { name: "raptr-agent-finder", version: "1.0.0" },
    tools: ["find_agents", "get_agent_code", "use_agent_here", "how_to_run_agent", "request_service"],
    instructions:
      "Find free, ready-made AI agents for a task in the open agent registry (RAR): find_agents, then get_agent_code for the best match, then " +
      "use_agent_here to run it in this chat on the user's own data. Nothing to install.",
  },
  names: {
    server: { name: "raptr-names", version: "1.0.0" },
    tools: ["check_names", "check_domain", "register_domain", "request_service"],
    instructions:
      "Help people name a business, product or project and make sure they can actually own the name: brainstorm candidates that fit what they " +
      "describe, check them with check_names, explain the trade-offs in plain words, and keep iterating until they have a name with a free domain.",
  },
  domains: {
    server: { name: "raptr-domains", version: "1.0.0" },
    tools: ["check_domain", "register_domain", "request_service"],
    instructions:
      "Help people and agents find and register domain names: suggest good names, check them with check_domain (up to 20 at once), " +
      "and explain how to buy with register_domain. Prices are in US dollars and include the first term.",
  },
  world: {
    server: { name: "dogg-world-check", version: "1.0.0" },
    tools: ["world_now", "fingerprint_text", "request_service"],
    instructions:
      "Give verified, citable numbers about the world right now with world_now: always quote the tick number, time and fingerprint with the numbers. " +
      "Use fingerprint_text to check whether texts are identical.",
  },
};

// ---------- tool implementations ----------

const RULES = [
  "One file. Everything goes in it. No extra files.",
  "File name must end with _agent.py and use snake_case (no dashes or spaces).",
  "Keep the __manifest__ block. Set name to @github_username/snake_name, plus version, display_name, description, author, tags and one category.",
  "Rename the class to match display_name with no spaces, and set self.name to the same value.",
  "perform() must always return a string, never None or a dict. Catch errors and return a message.",
  "No network calls in __init__().",
  "No hardcoded secrets. Read keys with os.environ.get() and list them in requires_env.",
  "Describe perform()'s inputs in self.metadata['parameters'] as a JSON schema so the Brainstem knows what to pass.",
];

function getTemplate() {
  return {
    text:
      "Fill in this template from what the user described. Rules:\n- " + RULES.join("\n- ") +
      "\n\nAllowed categories: " + CATEGORIES.join(", ") +
      "\n\nWhen done, call check_agent. Then call use_agent_here and offer to run it right now on the user's own data in this chat. Keeping it on their computer (how_to_run_agent) is optional and comes later." +
      "\n\n----- template_agent.py -----\n" + TEMPLATE,
    structured: { rules: RULES, categories: CATEGORIES, template: TEMPLATE },
  };
}

function manifestField(code, key) {
  const m = code.match(new RegExp(`["']${key}["']\\s*:\\s*(["'])(.*?)\\1`));
  return m ? m[2] : null;
}

// Body of a method: from its def line until the next line at the same or lower indent.
function methodBody(code, name) {
  const lines = code.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${name}\\s*\\(`).test(l));
  if (start < 0) return null;
  const indent = lines[start].match(/^\s*/)[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.match(/^\s*/)[0].length <= indent) break;
    out.push(l);
  }
  return out.join("\n");
}

export function checkAgent(filename, code) {
  const problems = [];
  const warnings = [];
  const fail = (s) => problems.push(s);

  if (!/^[a-z0-9_]+_agent\.py$/.test(filename || "")) fail("File name must be snake_case and end with _agent.py (e.g. invoice_triage_agent.py).");
  if (!code || !code.trim()) return { passed: false, problems: ["The file is empty."], warnings };
  if (code.length > 200_000) fail("The file is over 200 KB. Keep agents small and focused.");

  if (!/__manifest__\s*=\s*\{/.test(code)) fail("Missing the __manifest__ = { ... } block.");
  else {
    if (manifestField(code, "schema") !== "rapp-agent/1.0") fail('Manifest "schema" must be "rapp-agent/1.0".');
    const name = manifestField(code, "name");
    if (!name) fail('Manifest is missing "name".');
    else if (!/^@[A-Za-z0-9][A-Za-z0-9_-]*\/[a-z0-9_]+$/.test(name)) fail(`Manifest name "${name}" must look like @github_username/snake_case_name.`);
    else if (name.startsWith("@your_username")) fail("Replace @your_username in the manifest name with the user's GitHub username.");
    const version = manifestField(code, "version");
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('Manifest "version" must be like "1.0.0".');
    for (const k of ["display_name", "description", "author"]) {
      const v = manifestField(code, k);
      if (!v) fail(`Manifest is missing "${k}".`);
      else if (/^(Your Agent Name|Your Name|What your agent does in one sentence\.)$/.test(v)) fail(`Manifest "${k}" still has the template placeholder.`);
    }
    const cat = manifestField(code, "category");
    if (!cat) fail('Manifest is missing "category".');
    else if (!CATEGORIES.includes(cat)) warnings.push(`Category "${cat}" is not one of the template's: ${CATEGORIES.join(", ")}.`);
    if (!/["']tags["']\s*:\s*\[/.test(code)) fail('Manifest is missing a "tags" list.');
    else if (/["']keyword1["']/.test(code)) fail("Replace the placeholder tags (keyword1, keyword2).");
    if (!/["']dependencies["']\s*:\s*\[[^\]]*@rapp\/basic_agent/.test(code)) fail('Manifest "dependencies" must include "@rapp/basic_agent".');
  }

  if (!/from\s+(agents\.)?basic_agent\s+import\s+BasicAgent/.test(code)) fail("Missing the BasicAgent import (keep the try/except block from the template).");
  const cls = code.match(/^class\s+(\w+)\s*\(\s*BasicAgent\s*\)\s*:/m);
  if (!cls) fail("Missing a class that extends BasicAgent.");
  else if (cls[1] === "YourAgentName") fail("Rename the class from YourAgentName to match display_name.");

  const selfName = code.match(/self\.name\s*=\s*["']([^"']*)["']/);
  if (!selfName) fail("Set self.name in __init__.");
  else {
    if (/\s/.test(selfName[1])) fail(`self.name "${selfName[1]}" must not contain spaces.`);
    if (cls && selfName[1] !== cls[1]) warnings.push(`self.name "${selfName[1]}" differs from the class name "${cls[1]}". The template keeps them the same.`);
  }

  const perform = methodBody(code, "perform");
  if (perform === null) fail("Missing the perform(self, **kwargs) method.");
  else {
    if (!/\breturn\b/.test(perform)) fail("perform() never returns. It must return a string.");
    if (/\breturn\s*(None)?\s*$/m.test(perform)) fail("perform() has a bare return or returns None. It must return a string.");
    if (/\breturn\s*\{/.test(perform)) fail("perform() returns a dict. Convert it to a string (e.g. json.dumps).");
    if (/Hello from your new agent!/.test(perform)) fail("perform() still has the template placeholder logic.");
  }

  const init = methodBody(code, "__init__");
  if (init && /\b(requests\.|urllib|httpx\.|aiohttp|urlopen|socket\.)/.test(init)) fail("__init__() makes a network call. Move it into perform().");

  const secret = code.match(/^\s*\w*(key|token|secret|password)\w*\s*=\s*["'][A-Za-z0-9_\-]{16,}["']/im);
  if (secret) fail("Looks like a hardcoded secret. Read it with os.environ.get() and list it in requires_env.");
  if (/^[^#\n]*(os\.environ(\.get)?\s*[\[(]\s*["']|os\.getenv\s*\(\s*["'])/m.test(code) && /["']requires_env["']\s*:\s*\[\s*\]/.test(code)) warnings.push("The code reads environment variables but requires_env is empty. List them so users know what to set.");

  if (!/["']parameters["']\s*:/.test(code)) warnings.push("No parameters schema in self.metadata. The Brainstem won't know what inputs to pass.");

  return { passed: problems.length === 0, problems, warnings };
}

let registryCache = null;
async function loadRegistry() {
  if (registryCache && Date.now() - registryCache.at < 15 * 60_000) return registryCache.agents;
  const r = await fetch(REGISTRY_URL, { cf: { cacheTtl: 900, cacheEverything: true } });
  if (!r.ok) throw new Error(`registry returned ${r.status}`);
  const d = await r.json();
  const agents = (d.agents || []).map((a) => ({
    name: a.name,
    display_name: a.display_name,
    description: a.description,
    tags: a.tags || [],
    category: a.category,
    author: a.author,
    version: a.version,
    file: a._file,
    sha256: a._sha256,
  }));
  registryCache = { at: Date.now(), agents };
  return agents;
}

const STOPWORDS = new Set(["agent", "the", "for", "that", "with", "and", "are", "there", "any", "can", "help", "this", "from", "into", "find", "what", "which", "who", "how", "something", "thing", "one", "need", "want", "please", "show", "give", "get", "use", "tool", "app"]);

export function searchAgents(agents, query, limit = 5) {
  // Light stemming so "invoices" also matches "invoice".
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
    .map((w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => !STOPWORDS.has(w));
  if (!words.length) return [];
  const scored = agents.map((a) => {
    const title = `${a.display_name} ${a.name}`.toLowerCase();
    const tags = a.tags.join(" ").toLowerCase();
    const desc = (a.description || "").toLowerCase();
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 3;
      if (tags.includes(w)) s += 2;
      if (desc.includes(w)) s += 1;
    }
    return { a, s };
  });
  return scored.filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.a);
}

async function findAgents({ query, limit }) {
  const agents = await loadRegistry();
  const hits = searchAgents(agents, String(query || ""), Math.min(Math.max(limit || 5, 1), 10));
  if (!hits.length) {
    return { text: `No registry agents match "${query}". Offer to build one with get_agent_template.`, structured: { results: [] } };
  }
  const results = hits.map((a) => ({ ...a, code_url: a.file ? RAW_BASE + a.file : null }));
  const text = results.map((a, i) => `${i + 1}. ${a.display_name} (${a.name}) — ${a.description}`).join("\n") +
    "\n\nUse get_agent_code to read one, or how_to_run_agent to run it.";
  return { text, structured: { results } };
}

async function getAgentCode({ name }) {
  const agents = await loadRegistry();
  const a = agents.find((x) => x.name === name);
  if (!a || !a.file) return { text: `No agent named ${name} in the registry. Try find_agents.`, structured: { found: false }, isError: true };
  const r = await fetch(RAW_BASE + a.file, { cf: { cacheTtl: 900 } });
  if (!r.ok) return { text: `Could not load ${name} (status ${r.status}).`, structured: { found: false }, isError: true };
  const code = await r.text();
  // Verify the bytes against the registry's pinned hash before handing them over.
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const verified = !!a.sha256 && digest === a.sha256;
  const note = verified ? "Verified: matches the registry's SHA-256." : a.sha256 ? "WARNING: does not match the registry's SHA-256. Don't run it." : "No registry hash on file for this agent.";
  return { text: `${a.display_name} (${a.name} v${a.version})\n${note}\n\n${code}`, structured: { found: true, name: a.name, version: a.version, code_url: RAW_BASE + a.file, sha256: digest, registry_sha256: a.sha256 || null, verified, code } };
}

function useHere({ filename }) {
  const f = filename || "your_agent.py";
  const runner = [
    "import importlib.util, inspect, json",
    `spec = importlib.util.spec_from_file_location("agent", "${f}")  # save the agent file here first`,
    "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)",
    "Agent = next(c for _, c in inspect.getmembers(mod, inspect.isclass)",
    "             if c.__module__ == mod.__name__ and c.__name__ != 'BasicAgent' and hasattr(c, 'perform'))",
    "agent = Agent()",
    "args = {}  # fill from the user's data, matching agent.metadata['parameters']",
    "print(agent.perform(**args))",
  ].join("\n");
  const steps = [
    `Save the agent code to ${f} in your Python environment.`,
    "Ask the user for their real data if you don't have it yet (paste, upload, or a few rows). Offer a short sample only if they want to see it first.",
    "Run the runner below with args built from that data.",
    "If your Python tool is unavailable or limited (for example a daily limit), don't stop: read the agent's perform() and carry out its exact logic yourself on the user's data, step by step, and say plainly that you applied the agent's rules rather than running the file.",
    "Show the result in plain words. Don't show the runner unless they ask.",
    "Afterwards, mention they can keep the file and run it on their own computer any time (how_to_run_agent).",
    `If they need it connected to their real systems (accounting software, email, a CRM) or set up for a whole team, mention they can ask for help at ${CONTACT}.`,
  ];
  return {
    text: "Use the agent right here, nothing to install:\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n") + "\n\n```python\n" + runner + "\n```",
    structured: { steps, runner },
  };
}

function howToRun({ os, filename }) {
  const f = filename || "your_agent.py";
  const install = os === "windows"
    ? "irm https://raw.githubusercontent.com/kody-w/rapp-installer/main/install.ps1 | iex"
    : "curl -fsSL https://kody-w.github.io/rapp-installer/install.sh | bash";
  const folder = os === "windows" ? "%USERPROFILE%\\.brainstem\\src\\rapp_brainstem\\agents\\" : "~/.brainstem/src/rapp_brainstem/agents/";
  const steps = [
    `Install the free Brainstem (one line, in ${os === "windows" ? "PowerShell" : "Terminal"}): ${install}`,
    "Sign in with GitHub when it asks. The Brainstem uses your existing GitHub Copilot access.",
    `Save the agent as ${f} in ${folder}`,
    "Open http://localhost:7071 and ask for what the agent does. The Brainstem picks it up automatically.",
  ];
  return {
    text: "Optional: keep this agent running on your own computer.\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n") + `\n\nMore: ${SITE}`,
    structured: { steps, install_command: install, agents_folder: folder },
  };
}

const CONTACT = SITE + "contact.html";

export function scanPersonal(code) {
  const found = [];
  const emails = (code.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter((e) => !/example\.(com|org)$/i.test(e));
  if (emails.length) found.push(`email addresses (${[...new Set(emails)].slice(0, 3).join(", ")})`);
  if (/(\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/.test(code)) found.push("a phone number");
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(code)) found.push("something shaped like a US Social Security number");
  if (/\b(sk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}/.test(code)) found.push("an API key or token");
  return found;
}

function shareAgent({ filename, code }) {
  const check = checkAgent(filename, code);
  const personal = scanPersonal(code || "");
  if (!check.passed) {
    return { text: "Not ready to share yet. Fix these first:\n- " + check.problems.join("\n- "), structured: { ready: false, problems: check.problems, personal } };
  }
  if (personal.length) {
    return {
      text: "Not ready to share: the agent contains " + personal.join(", ") + ". Remove them, check again, then share.",
      structured: { ready: false, problems: [], personal },
    };
  }
  const steps = [
    "Save the agent file.",
    "Open https://kody-w.github.io/RAR/submit.html and sign in with GitHub. It publishes under your own account.",
    "Upload the file and submit. The registry checks it automatically, and once it's accepted anyone can find and use it.",
  ];
  return {
    text: "Ready to share. Nothing personal found.\n" + steps.map((x, i) => `${i + 1}. ${x}`).join("\n"),
    structured: { ready: true, steps, submit_url: "https://kody-w.github.io/RAR/submit.html" },
  };
}

async function worldNow() {
  const r = await fetch("https://kody-w.github.io/dogg/orient.json", { cf: { cacheTtl: 60 } });
  if (!r.ok) throw new Error(`world feed returned ${r.status}`);
  const d = await r.json();
  const w = d.world || {};
  const x = w.data || {};
  const lines = [];
  if (x.btc_usd) lines.push(`Bitcoin: $${Number(x.btc_usd.spot).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  if (x.crypto_market) lines.push(`Crypto market: $${(Number(x.crypto_market.total_mcap_usd) / 1e12).toFixed(2)} trillion, Bitcoin ${x.crypto_market.btc_dominance_pct}% of it`);
  if (x.fx_usd) lines.push("1 US dollar = " + Object.entries(x.fx_usd).map(([k, v]) => `${v} ${k}`).join(", "));
  if (x.earthquakes_past_hour) lines.push(`Earthquakes in the past hour: ${x.earthquakes_past_hour.count} (largest magnitude ${x.earthquakes_past_hour.max_mag})`);
  if (x.space_weather) lines.push(`Space weather Kp index: ${x.space_weather.kp}`);
  if (x.iss) lines.push(`Space Station position: ${x.iss.lat}, ${x.iss.lon}`);
  if (x.btc_block_height) lines.push(`Bitcoin block height: ${x.btc_block_height.height}`);
  const proof = { tick: w.tick, time_utc: w.utc, fingerprint: w.frame_hash, tick_fingerprint: w.tick_frame, source: "https://kody-w.github.io/dogg/orient.json" };
  return {
    text: lines.join("\n") + `\n\nVerified snapshot: tick ${proof.tick} at ${proof.time_utc}, fingerprint ${proof.fingerprint}. Anyone can check it at ${proof.source}.`,
    structured: { data: x, proof },
  };
}

async function fingerprintText({ text, expected }) {
  const bytes = new TextEncoder().encode(text || "");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const out = { fingerprint: hex, characters: (text || "").length };
  let line = `SHA-256 fingerprint: ${hex}`;
  if (expected) {
    out.matches = expected.trim().toLowerCase() === hex;
    line += out.matches ? "\nMatches the expected fingerprint: the text is exactly the same." : "\nDoes NOT match the expected fingerprint: the text is different.";
  }
  return { text: line, structured: out };
}

let currentListing = "";
let activeEnv = {};
async function callTool(name, args) {
  switch (name) {
    case "get_agent_template": return getTemplate();
    case "check_agent": {
      const r = checkAgent(args.filename, args.code);
      const text = r.passed
        ? "PASSED. The agent follows the template rules." + (r.warnings.length ? "\nSuggestions:\n- " + r.warnings.join("\n- ") : "")
        : "NOT YET. Fix these and check again:\n- " + r.problems.join("\n- ") + (r.warnings.length ? "\nAlso:\n- " + r.warnings.join("\n- ") : "");
      return { text, structured: r };
    }
    case "find_agents": return findAgents(args);
    case "get_agent_code": return getAgentCode(args);
    case "use_agent_here": return useHere(args);
    case "how_to_run_agent": return howToRun(args);
    case "share_agent": return shareAgent(args);
    case "world_now": return worldNow();
    case "fingerprint_text": return fingerprintText(args);
    case "request_service": return (await import("./signals.js")).recordRequest(activeEnv, { request: args.request, listing: currentListing });
    case "check_names": return (await import("./domains.js")).checkNames(args);
    case "check_domain": return (await import("./domains.js")).checkDomains(args);
    case "register_domain": return (await import("./domains.js")).registerInfo(args, SITE);
    default: return null;
  }
}

// ---------- MCP JSON-RPC ----------

async function handleRpc(msg, profile = PROFILES.builder) {
  const tools = TOOLS.filter((t) => profile.tools.includes(t.name));
  const { id, method, params = {} } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  if (id === undefined || id === null) return null; // notification: no response body
  switch (method) {
    case "initialize": {
      const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok({
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: profile.server,
        instructions: profile.instructions,
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return err(-32602, `Unknown tool: ${params.name}`);
      try {
        currentListing = profile.server.name;
        const r = await callTool(params.name, params.arguments || {});
        usage(profile, params.name, !r.isError);
        return ok({ content: [{ type: "text", text: r.text }], structuredContent: r.structured, isError: !!r.isError });
      } catch (e) {
        usage(profile, params.name, false);
        return ok({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    default: return err(-32601, `Method not found: ${method}`);
  }
}

// ---------- agent-readable discovery: llms.txt, /.well-known/mcp.json, A2A agent card ----------

function llmsTxt(origin) {
  return `# Raptr

> AI agents anyone can use. Three free, read-only MCP servers: build a single-file AI agent from an idea and run it on the user's data, find one of about 1,700 ready-made agents, or get verified world numbers with a public SHA-256 fingerprint. No account, no API key, nothing stored.

## MCP servers (streamable HTTP, no auth)

- [Raptr Agent Builder](${origin}/mcp): get_agent_template, check_agent, use_agent_here, find_agents, get_agent_code, share_agent, how_to_run_agent
- [Raptr Agent Finder](${origin}/finder/mcp): find_agents, get_agent_code, use_agent_here, how_to_run_agent
- [DOGG World Check](${origin}/world/mcp): world_now, fingerprint_text
- [Raptr Domains](${origin}/domains/mcp): check_domain, register_domain

## Pay per call (x402 v2, USDC)

- GET ${origin}/x402/world: fresh verified world snapshot, $0.001
- POST ${origin}/x402/domains/register?domain=NAME: register an available domain; the 402 response quotes the price; charged only if registration succeeds (raise your x402 client's default $1 per-payment cap first)

## A2A

- [Agent card](${origin}/.well-known/agent-card.json): JSON-RPC message/send at ${origin}/a2a. Skills: find_agents, world_now, agent_template.

## Docs

- [Website](${SITE}): what it does, in plain words
- [Source](https://github.com/airaptr/airaptr.github.io): server code, listing packages, tests
- [Agent registry](https://kody-w.github.io/RAR/): the open agent registry (RAR)
- [Privacy](${SITE}privacy.html) and [Terms](${SITE}terms.html)
`;
}

function mcpWellKnown(origin) {
  return {
    servers: Object.entries(PROFILES).map(([k, p]) => ({
      name: p.server.name,
      version: p.server.version,
      description: p.instructions,
      transport: "streamable-http",
      url: `${origin}${k === "builder" ? "" : "/" + k}/mcp`,
      authentication: "none",
      tools: p.tools,
    })),
    website: SITE,
    llms_txt: `${origin}/llms.txt`,
  };
}

const A2A_SKILLS = [
  { id: "find_agents", name: "Find agents", description: "Search the open agent registry (RAR) (about 1,700 single-file agents) for agents that do a task. Send the task in plain words.", tags: ["agents", "registry", "search"], examples: ["agents that summarize sales calls", "invoice processing"] },
  { id: "world_now", name: "World now", description: "Verified snapshot of world numbers right now (Bitcoin, FX, earthquakes, space weather, ISS) with the public DOGG tick, time and SHA-256 fingerprint.", tags: ["world-data", "verification"], examples: ["what is happening in the world right now"] },
  { id: "agent_template", name: "Agent template", description: "The official single-file agent template and its rules, so the calling agent can write a new agent.", tags: ["agents", "template"], examples: ["give me the agent template"] },
];

function agentCard(origin) {
  return {
    name: "Raptr",
    description: "AI agents anyone can use: find ready-made agents, get the template to build one, and get verified world numbers. Read-only, no auth, nothing stored.",
    // A2A 1.0 lists endpoints here; the 0.3 fields below keep older clients working on the same endpoint.
    supportedInterfaces: [
      { url: `${origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "" },
      { url: `${origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "0.3", tenant: "" },
    ],
    protocolVersion: "0.3.0",
    url: `${origin}/a2a`,
    preferredTransport: "JSONRPC",
    securitySchemes: {},
    securityRequirements: [],
    iconUrl: `${SITE}icon-256.png`,
    version: PROFILES.builder.server.version,
    provider: { organization: "Wildhaven Homes LLC", url: SITE },
    documentationUrl: `${origin}/llms.txt`,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: A2A_SKILLS,
  };
}

// Deterministic skill routing: an explicit metadata.skill wins; otherwise simple keyword matching.
export function pickSkill(text, meta = {}) {
  if (meta && A2A_SKILLS.some((k) => k.id === meta.skill)) return meta.skill;
  const t = (text || "").toLowerCase();
  if (/\b(world|right now|bitcoin|btc|exchange rate|earthquake|space weather|iss|fingerprint)\b/.test(t)) return "world_now";
  if (/\btemplate\b/.test(t)) return "agent_template";
  return "find_agents";
}

async function handleA2A(msg) {
  const { id, method, params = {} } = msg || {};
  const err = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  const v1 = method === "SendMessage";
  if (!v1 && method !== "message/send") return err(-32601, `Method not found: ${method}. Supported: SendMessage (A2A 1.0), message/send (A2A 0.3)`);
  const m = params.message || {};
  const text = (m.parts || []).filter((p) => typeof p.text === "string").map((p) => p.text).join("\n").trim();
  const skill = pickSkill(text, m.metadata || params.metadata);
  let r;
  if (skill === "world_now") r = await worldNow();
  else if (skill === "agent_template") r = getTemplate();
  else r = await findAgents({ query: text, limit: 5 });
  usage({ server: { name: "rapp-a2a" } }, skill, !r.isError);
  const contextId = m.contextId || crypto.randomUUID();
  if (v1) {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        message: {
          messageId: crypto.randomUUID(),
          contextId,
          role: "ROLE_AGENT",
          parts: [{ text: r.text }, { data: { skill, ...r.structured }, mediaType: "application/json" }],
        },
      },
    };
  }
  return {
    jsonrpc: "2.0",
    id,
    result: {
      kind: "message",
      role: "agent",
      messageId: crypto.randomUUID(),
      contextId,
      parts: [{ kind: "text", text: r.text }, { kind: "data", data: { skill, ...r.structured } }],
    },
  };
}

// Usage counting: which listing and tool, and whether it worked. Never arguments or content.
function usage(profile, tool, ok) {
  console.log(JSON.stringify({ evt: "tool_call", listing: profile.server.name, tool, ok }));
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(request, env = {}) {
    activeEnv = env;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    // OpenAI domain verification: serve exactly the token the plugin portal issues.
    if (url.pathname === "/.well-known/openai-apps-challenge") {
      const token = env.OPENAI_APPS_CHALLENGE || globalThis.process?.env?.OPENAI_APPS_CHALLENGE;
      return token
        ? new Response(token.trim(), { headers: { "Content-Type": "text/plain" } })
        : new Response("not configured", { status: 404 });
    }
    if (url.pathname.startsWith(PAID_PREFIX)) {
      const { handlePaid, PAID_ROUTES } = await import("./paid.js");
      if (!PAID_ROUTES.includes(url.pathname)) return json({ error: "not found" }, 404);
      const produce = url.pathname === "/x402/domains/register"
        ? async () => {
            const { orderQuote, registerAtPorkbun } = await import("./domains.js");
            const q = await orderQuote(url.searchParams.get("domain"), env);
            return registerAtPorkbun(env, q.domain);
          }
        : async () => {
            const r = await worldNow();
            return { ...r.structured, summary: r.text };
          };
      return handlePaid(request, env, produce, (e) => console.log(JSON.stringify({ evt: "paid_call", ...e })), CORS);
    }
    if (url.pathname === "/signals") {
      const key = env.LEDGER_ADMIN_KEY || globalThis.process?.env?.LEDGER_ADMIN_KEY;
      if (!key || request.headers.get("x-admin-key") !== key) return json({ error: "not found" }, 404);
      const day = url.searchParams.get("day") || new Date().toISOString().slice(0, 10);
      return json({ day, requests: await (await import("./signals.js")).listRequests(env, day) });
    }
    if (url.pathname === "/ledger/clients" && request.method === "POST") {
      const key = env.LEDGER_ADMIN_KEY || globalThis.process?.env?.LEDGER_ADMIN_KEY;
      if (!key || request.headers.get("x-admin-key") !== key) return json({ error: "not found" }, 404);
      const ledger = await import("./ledger.js").catch(() => null);
      if (!ledger) return json({ error: "not found" }, 404);
      const { registerClient } = ledger;
      try { return json(await registerClient(env, await request.json())); } catch (e) { return json({ error: e.message }, 400); }
    }
    if (url.pathname === "/ledger/statement") {
      // Admin sees the whole company's books; a client key sees only that client's own receipts.
      const key = env.LEDGER_ADMIN_KEY || globalThis.process?.env?.LEDGER_ADMIN_KEY;
      const ledger = await import("./ledger.js").catch(() => null);
      if (!ledger) return json({ error: "not found" }, 404);
      const { statement, toCsv, clientForKey } = ledger;
      const isAdmin = key && request.headers.get("x-admin-key") === key;
      const client = isAdmin ? null : await clientForKey(env, request.headers.get("x-client-key"));
      if (!isAdmin && !client) return json({ error: "not found" }, 404);
      const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: "month must look like 2026-10" }, 400);
      const st = { ...(await statement(env, month, client?.wallet)), ...(client ? { client: client.name } : {}) };
      return url.searchParams.get("format") === "csv"
        ? new Response(toCsv(st), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="wildhaven-ledger-${month}.csv"` } })
        : json(st);
    }
    if (url.pathname === "/llms.txt") return new Response(llmsTxt(url.origin), { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
    if (url.pathname === "/.well-known/mcp.json") return json(mcpWellKnown(url.origin));
    if (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json") return json(agentCard(url.origin));
    if (url.pathname === "/a2a") {
      if (request.method !== "POST") return json(agentCard(url.origin));
      let msg;
      try { msg = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
      return json(await handleA2A(msg));
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, listings: Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [p.server.name, { version: p.server.version, mcp: `${url.origin}${k === "builder" ? "" : "/" + k}/mcp` }])), site: SITE });
    }
    const route = { "/mcp": "builder", "/finder/mcp": "finder", "/world/mcp": "world", "/domains/mcp": "domains", "/names/mcp": "names" }[url.pathname];
    if (!route) return json({ error: "not found" }, 404);
    const profile = PROFILES[route];
    if (request.method === "GET") return new Response("SSE stream not offered; POST JSON-RPC to /mcp.", { status: 405, headers: { Allow: "POST", ...CORS } });
    if (request.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    let body;
    try { body = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleRpc(m, profile)))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
    }
    const out = await handleRpc(body, profile);
    return out ? json(out) : new Response(null, { status: 202, headers: CORS });
  },
};
