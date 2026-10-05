# ChatGPT app directory submission

Submit at platform.openai.com (Apps), from a verified OpenAI platform account.

| Field | Value |
|---|---|
| Name (≤30) | Raptr Agent Builder |
| Short description (≤30) | Turn any idea into an AI agent |
| Developer | Wildhaven Homes LLC |
| Website | https://kody-w.github.io/airaptr/ |
| Privacy policy | https://kody-w.github.io/airaptr/privacy.html |
| Terms | https://kody-w.github.io/airaptr/terms.html |
| Icon | docs/icon-64.png (64×64, under 5 KB); docs/icon-256.png (256×256, under 10 KB) for the plugin form |
| MCP server | https://airaptr-api.azurewebsites.net/mcp |
| Authentication | None |
| Commerce | None, no purchases |
| Countries | All available |

## Long description

Describe a task, or paste a meeting transcript, and Raptr Agent Builder turns it into a working AI
agent: one Python file you can read, keep, and run on your own computer.

Before building, it checks the open agent registry (RAR), about 1,700 free agents, in case one
already does the job. When it builds a new one, it uses the official template and checks the
finished file against the template's rules, fixing problems until it passes. Then it tells you how
to run the agent with the free Brainstem on Mac, Windows, or Linux.

Good for: turning a recurring process into an agent, prototyping an assistant for your team from
a meeting, or finding an existing agent before you write one.

The app asks for no account and stores nothing you send it.

## Test prompts for reviewers

1. "Is there already an agent that summarizes sales calls?" → find_agents returns registry matches.
2. "Build me an agent that sorts invoices into pay now, review, or hold based on amount and due date." → get_agent_template, then check_agent until PASSED.
3. "Show me the code for @cat-agent-skills/meeting_analyzer." → get_agent_code.
4. "How do I run this on Windows?" → how_to_run_agent.

## Screenshots

Demo video: https://kody-w.github.io/airaptr/demo.mp4 (59 s, recorded in ChatGPT developer mode, set as review.demo_recording_url).
