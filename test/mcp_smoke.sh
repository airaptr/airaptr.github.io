#!/bin/bash
# Stored test: drives the MCP endpoint like ChatGPT does. Usage: test/mcp_smoke.sh <base-url>
B=${1:-http://localhost:8787}
rpc(){ curl -s "$B/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$1"; echo; }
rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | head -c 300; echo
curl -s -o /dev/null -w "notification -> %{http_code}\n" "$B/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | python3 -c "import sys,json;print('tools:',[t['name'] for t in json.load(sys.stdin)['result']['tools']])"
rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_agents","arguments":{"query":"meeting notes summary","limit":3}}}' | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['content'][0]['text'][:500])"
rpc '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_agent_template","arguments":{}}}' | python3 -c "import sys,json;r=json.load(sys.stdin)['result'];print('template chars:',len(r['structuredContent']['template']))"
rpc '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"how_to_run_agent","arguments":{"os":"mac","filename":"invoice_triage_agent.py"}}}' | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['content'][0]['text'])"
