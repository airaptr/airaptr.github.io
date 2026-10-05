# Raptr Agent Builder (ChatGPT app)

A ChatGPT app that turns an idea or a meeting transcript into a working single-file agent.
ChatGPT's own model writes the agent; this MCP server supplies the template, checks the result,
searches the public [open agent registry (RAR)](https://github.com/kody-w/RAR), and explains how to run
the agent in the free Brainstem.

It sits on top of the ecosystem and never changes the Brainstem: it reads the public registry and
points at the public installer.

- MCP endpoint: `https://airaptr-api.azurewebsites.net/mcp` (streamable HTTP, stateless, JSON responses)
- Site, privacy, terms: https://kody-w.github.io/airaptr/

## Tools

| Tool | What it does |
|---|---|
| `get_agent_template` | The official template and its rules |
| `check_agent` | Checks a finished agent file against the rules |
| `find_agents` | Searches the registry |
| `get_agent_code` | Returns one registry agent's source |
| `use_agent_here` | Runner so ChatGPT runs the agent in the chat on the user's data |
| `how_to_run_agent` | Optional: keep it on your computer (Mac, Windows, Linux) |

## Develop

```bash
node build_template.mjs ../RAR/template_agent.py   # refresh the embedded template
npx wrangler dev                                   # local server on :8787
node test/check_real_agents.mjs ../RAR             # checker vs. the template and every registry agent
test/mcp_smoke.sh http://localhost:8787            # drive the MCP endpoint
npx wrangler deploy                                # Cloudflare host
azure/deploy.sh                                    # or Azure Functions
```

Listing copy for the ChatGPT app directory is in [SUBMISSION.md](SUBMISSION.md).
