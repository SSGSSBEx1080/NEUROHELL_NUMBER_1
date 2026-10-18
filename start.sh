#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! node -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=12)?0:1)'; then
  echo 'Install Node.js 22.12+ or 24 LTS from https://nodejs.org/ and run this script again.'
  exit 1
fi
if [ ! -f node_modules/vite/bin/vite.js ]; then npm ci; fi
echo 'FSH 777: http://localhost:5173 — keep this terminal open. Ctrl+C to stop.'
exec npm start
