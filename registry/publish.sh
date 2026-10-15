#!/bin/bash
# Publishes registry/*.server.json to the official MCP Registry under com.airaptr/* (DNS proof of airaptr.com).
# Needs, once: the TXT record "v=MCPv1; k=ed25519; p=<public key>" on the apex of airaptr.com, made from the
# private key below. The key stays on this machine (never in a repo) and is never printed.
set -euo pipefail
cd "$(dirname "$0")"
KEY=${MCP_DNS_KEY:-$HOME/.config/airaptr/mcp-registry-dns-key.pem}
[ -f "$KEY" ] || { echo "No key at $KEY"; exit 1; }
PUB="$(openssl pkey -in "$KEY" -pubout -outform DER | tail -c 32 | base64)"
dig +short TXT airaptr.com | grep -qF "p=$PUB" || { echo "airaptr.com has no TXT record for this key yet: v=MCPv1; k=ed25519; p=$PUB"; exit 1; }
mcp-publisher login dns --domain airaptr.com --private-key "$(openssl pkey -in "$KEY" -outform DER | tail -c 32 | xxd -p -c 64)" >/dev/null
for f in *.server.json; do mcp-publisher publish "$f"; done
