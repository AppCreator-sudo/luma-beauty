#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node -e 'const [major,minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) throw Error("Select Node.js >=22.13; project baseline is .nvmrc")'
npm ci
npm --prefix frontend ci
npm --prefix frontend run build
npm run build
python3 scripts/validate-docs.py
if [[ -f deploy/cloud-transfer/source-data/atelie.sqlite ]]; then
  node scripts/cloud-private.mjs verify
  if [[ ! -d .local-data/cloud-source ]]; then
    node scripts/cloud-private.mjs restore
  fi
  if [[ ! -d .local-data/cloud-dev ]]; then
    node scripts/cloud-private.mjs prepare-dev
  fi
  python3 -m pip install --target .local-data/cloud-tools 'paramiko==4.0.0'
fi
if [[ "${LUMA_INSTALL_BROWSER:-1}" == "1" ]]; then
  npx playwright install chromium
fi
echo "Setup complete. Use the isolated environment values in docs/CODEX_CLOUD.md, then npm start; UI is /v2/."
