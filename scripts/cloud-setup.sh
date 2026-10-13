#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node -e 'const [major,minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) throw Error("Select Node.js >=22.13; project baseline is .nvmrc")'
npm ci
npm --prefix frontend ci
npm --prefix frontend run build
npm run build
python3 scripts/validate-docs.py
if [[ "${LUMA_INSTALL_BROWSER:-1}" == "1" ]]; then
  npx playwright install chromium
fi
echo "Setup complete. Use the isolated environment values in docs/CODEX_CLOUD.md, then npm start; UI is /v2/."
