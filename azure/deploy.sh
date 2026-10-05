#!/bin/bash
# Deploys to the Raptr Azure subscription only, from an isolated az profile. The expected account
# lives in azure/.env.local (untracked): Raptr_AZ_USER=<account email>.
set -euo pipefail
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export AZURE_CONFIG_DIR="$HOME/.azure-personal"
cd "$(dirname "$0")"
USER_NAME=$(az account show --query user.name -o tsv)
[ -f .env.local ] && . ./.env.local
[ -n "${Raptr_AZ_USER:-}" ] || { echo "Set Raptr_AZ_USER in azure/.env.local first"; exit 1; }
[ "$USER_NAME" = "$Raptr_AZ_USER" ] || { echo "Refusing: signed in as $USER_NAME, expected $Raptr_AZ_USER"; exit 1; }
RG=${RG:-airaptr}; LOC=${LOC:-eastus2}; APP=${APP:-airaptr-api}
SA=${SA:-airaptr$(az account show --query id -o tsv | tr -d - | cut -c1-6)}
rm -rf src/core && mkdir -p src/core && cp ../src/index.js ../src/template.js ../src/paid.js ../src/domains.js ../src/signals.js ../src/kit.js src/core/
# Private parts (ledger, org model) come from the estate repo when it is present beside this one.
[ -f ../../estate/ledger.js ] && cp ../../estate/ledger.js ../../estate/org.js src/core/
npm install --omit=dev --silent
az group create -n "$RG" -l "$LOC" -o none
az storage account show -n "$SA" -g "$RG" -o none 2>/dev/null || az storage account create -n "$SA" -g "$RG" -l "$LOC" --sku Standard_LRS --allow-blob-public-access false -o none
az functionapp show -n "$APP" -g "$RG" -o none 2>/dev/null || az functionapp create -n "$APP" -g "$RG" -s "$SA" --flexconsumption-location "$LOC" --runtime node --runtime-version 22 -o none
func azure functionapp publish "$APP" --javascript
echo "MCP endpoint: https://$APP.azurewebsites.net/mcp"
