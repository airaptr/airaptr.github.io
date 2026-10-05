"""
YOUR AGENT NAME — Describe what your agent does in one sentence.

╔══════════════════════════════════════════════════════════════╗
║  AGENT TEMPLATE                                        ║
║                                                              ║
║  How to use:                                                 ║
║  1. Give this file to any LLM (ChatGPT, Copilot, Claude)    ║
║  2. Tell it what you want your agent to do                   ║
║  3. It fills in the blanks and writes the perform() logic    ║
║  4. Save the result as  your_agent_name_agent.py             ║
║  5. Submit at  https://kody-w.github.io/RAR/submit.html     ║
║                                                              ║
║  Rules:                                                      ║
║  - One file. Everything goes here. No extra files.           ║
║  - File name MUST end with _agent.py                         ║
║  - snake_case everywhere (no dashes)                         ║
║  - perform() MUST return a string                            ║
║  - No network calls in __init__()                            ║
║  - No hardcoded secrets — use os.environ.get()               ║
╚══════════════════════════════════════════════════════════════╝

Example prompt for your LLM:

  "Using this template, build me an agent that [YOUR IDEA HERE].
   Fill in the manifest, write the perform() method, and make
   sure it returns a string. Keep it in one file."
"""

import os

# ═══════════════════════════════════════════════════════════════
# AGENT MANIFEST — Do not remove. Used by registry builder.
# ═══════════════════════════════════════════════════════════════
__manifest__ = {
    "schema": "rapp-agent/1.0",

    # CHANGE THESE — replace @your_username with your GitHub username
    "name": "@airaptr/greeting_agent",
    "version": "1.0.0",
    "display_name": "Greeting Maker",
    "description": "Writes a short, friendly greeting for a name.",
    "author": "Airaptr",

    # Tags help people find your agent — pick 2-5 keywords
    "tags": ["greeting", "demo"],

    # Pick ONE category:
    #   core, pipeline, integrations, productivity, devtools,
    #   b2b_sales, b2c_sales, energy, federal_government,
    #   financial_services, general, healthcare, human_resources,
    #   it_management, manufacturing, professional_services,
    #   retail_cpg, slg_government, software_digital_products
    "category": "general",

    "quality_tier": "community",

    # List any environment variables your agent needs (empty = none)
    # Example: ["OPENAI_API_KEY", "MY_API_TOKEN"]
    "requires_env": [],

    # Don't change this — every agent depends on BasicAgent
    "dependencies": ["@rapp/basic_agent"],
}
# ═══════════════════════════════════════════════════════════════


# This import lets your agent run inside the ecosystem
try:
    from agents.basic_agent import BasicAgent
except ModuleNotFoundError:
    # Fallback so the file also runs standalone: python your_agent_name_agent.py
    class BasicAgent:
        def __init__(self, name, metadata):
            self.name = name
            self.metadata = metadata


class GreetingMaker(BasicAgent):
    """
    RENAME this class to match your display_name (no spaces).
    Example: display_name "Weather Checker" → class WeatherChecker
    """

    def __init__(self):
        # Runtime names become function names, so they must not contain spaces.
        self.name = "GreetingMaker"
        self.metadata = {
            "name": self.name,
            "display_name": __manifest__["display_name"],
            "description": __manifest__["description"],
            "parameters": {"type": "object", "properties": {}},
        }
        super().__init__(self.name, self.metadata)

        # Set up any state your agent needs (no network calls here)
        # Example:
        # self.default_city = "Seattle"

    def perform(self, name="friend", **kwargs):
        """Return a greeting."""
        try:
            return f"Hello, {str(name).strip() or 'friend'}! Nice to meet you."
        except Exception as e:
            return f"Could not write a greeting: {e}"
