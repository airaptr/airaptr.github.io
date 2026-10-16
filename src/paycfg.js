// x402 settings, read without loading the x402 libraries (the free store catalog and previews quote them too).
// Defaults are the Base Sepolia testnet. See paid.js for what each setting means.
export function paidConfig(env = {}) {
  const get = (k) => env[k] || globalThis.process?.env?.[k];
  return {
    payTo: get("X402_PAY_TO"),
    network: get("X402_NETWORK") || "eip155:84532",
    facilitator: get("X402_FACILITATOR") || "https://x402.org/facilitator",
    price: get("X402_PRICE") || "$0.001",
    priceRescue: get("X402_PRICE_RESCUE") || "$0.50",
    priceListing: get("X402_PRICE_LISTING") || "$0.50", // Kody, 2026-10-16: same as Rescue
    // Whether Coinbase's facilitator key is set (Base mainnet needs it). Only a yes/no here: the key itself is read in
    // paid.js at the moment of use and never enters this object, which is cached, logged and shown in /store.json.
    cdp: Boolean(get("CDP_API_KEY_ID") && get("CDP_API_KEY_SECRET")),
  };
}
