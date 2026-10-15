// The store catalog for agents (GET /store.json): what we sell, what is free, what it costs, how to call it,
// a real sample, and the terms. Prices and the network come from the live x402 settings, so this never drifts
// from what the 402 response quotes. Plain, checkable claims only (handbook/ETHOS.md §6).

import { rescue, preview, MAX_INPUT_BYTES } from "./rescue.js";

const NETWORKS = {
  "eip155:84532": "Base Sepolia (testnet: test USDC, no real money)",
  "eip155:8453": "Base (mainnet: real USDC)",
};

export const SAMPLE_REJECTION = `Guideline 5.1.1(i) - Legal - Privacy - Data Collection and Storage
Guideline 5.1.2(i) - Legal - Privacy - Data Use and Sharing

The app appears to share the user's personal data with a third-party AI service but the app does not clearly explain
what data is sent, identify who the data is sent to and ask the user's permission before sharing.

Guideline 5.2.5 - Legal - Intellectual Property

Your app's metadata includes Apple product names in a way that may be confusing.
`;
const SAMPLE_CHANGES = "Added an Allow / Not now consent screen before the first message is sent.";

export function rescueOffer(origin, cfg) {
  return {
    route: `POST ${origin}/x402/rescue`,
    price: cfg.priceRescue,
    network: cfg.network,
    payment: "x402 v2, exact scheme, USDC",
  };
}

export function storeCatalog(origin, cfg) {
  const on = !!cfg.payTo;
  const network = { id: cfg.network, name: NETWORKS[cfg.network] || cfg.network, testnet: cfg.network !== "eip155:8453" };
  const sampleBody = { text: SAMPLE_REJECTION, changes: SAMPLE_CHANGES };
  return {
    store: "Raptr agent store",
    seller: { name: "Wildhaven Homes LLC", site: "https://airaptr.github.io/" },
    for: "AI agents buying for their owner; people can use the same routes.",
    payments: {
      protocol: "x402 v2 (HTTP 402). No account or API key.",
      paid_routes_on: on,
      network,
      how: "Call the paid route without payment to get a 402 with a PAYMENT-REQUIRED header (base64 JSON: price, network, asset, payTo). Sign the payment with your x402 client and repeat the same request with a PAYMENT-SIGNATURE header.",
    },
    terms: {
      charge: "Charged only when the paid output is delivered. If the work fails or settlement fails, no output is returned and nothing is charged.",
      data: "Your rejection text and the reply are used to answer the request and are not stored. For paid calls we keep the payment receipt (amount, network, payer wallet address, transaction) for our books.",
      refunds: "Settled payments are final on-chain; if a paid result is wrong, tell us at https://airaptr.github.io/contact.html.",
      receipts: "Every Rejection Rescue response carries sha256: the SHA-256 of the response body as canonical JSON (keys sorted, no whitespace, UTF-8, without the sha256 fields), so you can check what you received.",
      privacy: "https://airaptr.github.io/privacy.html",
      terms: "https://airaptr.github.io/terms.html",
    },
    products: [
      {
        id: "rejection-rescue",
        name: "Rejection Rescue",
        status: on ? "available" : "paid part not switched on yet",
        description: "Turns an Apple App Review rejection message into a diagnosis per guideline section, a fix list and a draft reply to App Review that answers each of Apple's numbered questions. It works from the text alone; it does not look at your app. The reply is a draft for you or your owner to check and send.",
        covers: "Playbook sections 2.1, 2.3, 2.3.3, 2.3.10, 2.5.4, 3.1.1, 3.1.2, 4.2, 4.3, 4.8, 5.1.1, 5.1.2, 5.2.5 (a cited sub-section uses its closest parent). Sections outside the playbook are listed as unknown, not guessed.",
        free_part: "The guideline sections recognized, with the title and what Apple means by each, and how many questions Apple asked.",
        paid_part: "For each section: likely causes, what to check, the fix steps; the fix list as cards; the reply draft with your changes and recording link filled in; and what is still missing before it can be sent.",
        price: cfg.priceRescue,
        network: cfg.network,
        input: {
          content_type: "application/json",
          body: { text: "Apple's rejection message (required)", changes: "what you changed (optional)", recording_url: "link to a real-device screen recording (optional)" },
          limit_bytes: MAX_INPUT_BYTES,
          refused_before_payment: "empty text (400), invalid JSON (400), over 20 KB (413), no guideline section the playbook knows (422)",
        },
        free: {
          http: `POST ${origin}/rescue/preview`,
          mcp: { server: `${origin}/mcp`, tool: "rejection_rescue_preview", arguments: { text: "..." } },
          a2a: { endpoint: `${origin}/a2a`, skill: "rejection_rescue_preview" },
        },
        paid: {
          http: `POST ${origin}/x402/rescue`,
          mcp: null,
          note: "The paid part is HTTP only (x402). There is no paid MCP tool.",
        },
        sample: {
          input: sampleBody,
          preview_output: preview(SAMPLE_REJECTION, rescueOffer(origin, cfg)),
          paid_output: rescue(SAMPLE_REJECTION, { changes: SAMPLE_CHANGES }),
        },
      },
      {
        id: "rapple-sim",
        name: "rapple-sim",
        status: "coming soon",
        description: "An MCP server (stdio, Python standard library) that lets an agent drive the iOS Simulator on its own Mac: boot devices, install and launch apps, see the screen, tap and type, record video, read logs and crashes.",
        free_part: "All of it.",
        paid_part: null,
        price: "free",
        network: null,
        how_to_call: "Not downloadable yet. It will be listed here and in the MCP Registry when it is.",
      },
      {
        id: "will-it-pass",
        name: "\"Will it pass?\" listing check",
        status: "coming soon",
        description: "Checks an App Store listing (metadata and screenshot URLs) against the review checks Apple applies to listings, before you submit.",
        free_part: "Pass or fail per check (planned).",
        paid_part: "The findings with fixes (planned).",
        price: "not set yet",
        network: cfg.network,
        how_to_call: "Not available yet.",
      },
    ],
  };
}
