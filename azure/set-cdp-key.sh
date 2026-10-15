#!/bin/bash
# Put Coinbase's CDP API key (the x402 facilitator key for real money) into the live app's settings, straight from the
# file the CDP portal downloads. Kody runs this himself; it never prints the secret and never stores it anywhere else.
#   azure/set-cdp-key.sh ~/Downloads/cdp_api_key.json
set -euo pipefail
FILE="${1:-$(ls -t ~/Downloads/cdp_api_key*.json 2>/dev/null | head -1)}"
[ -f "$FILE" ] || { echo "No key file. Download it from the CDP portal first (Download API key)."; exit 1; }
export AZURE_CONFIG_DIR=~/.azure-personal
read -r ID SECRET < <(python3 - "$FILE" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
kid = d.get("id") or d.get("name") or d.get("keyId") or ""
sec = d.get("privateKey") or d.get("secret") or d.get("key") or ""
if not kid or not sec:
    sys.exit("The file doesn't look like a CDP API key (no id/privateKey).")
print(kid, sec.replace("\n", "\\n"))
EOF
)
az functionapp config appsettings set -g airaptr -n airaptr-api \
  --settings "CDP_API_KEY_ID=$ID" "CDP_API_KEY_SECRET=$SECRET" -o none
unset SECRET
echo "Done: CDP key ${ID:0:8}… is set on airaptr-api (secret not shown). You can delete $FILE now."
