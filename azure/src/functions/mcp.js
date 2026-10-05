// Azure Functions host for the same handler the Cloudflare Worker uses (../../../src/index.js is copied in at deploy).
import { app } from "@azure/functions";
import worker from "../core/index.js";

app.http("mcp", {
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: async (req) => {
    const init = { method: req.method, headers: Object.fromEntries(req.headers.entries()) };
    if (!["GET", "HEAD"].includes(req.method)) init.body = await req.text();
    const res = await worker.fetch(new Request(req.url, init));
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.text() };
  },
});
