#!/usr/bin/env bash
# Idempotent bootstrap for SolarWatch. Run from the project root:  bash deploy/install.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install Node 20+ first, e.g.:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node $(node -v) is too old — SolarWatch needs Node 20+."
  exit 1
fi
echo "    Node $(node -v) OK"

echo "==> Installing dependencies (npm ci)"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
  echo "    Edit .env now: DESS_USERNAME, DESS_PASSWORD, and the rest."
fi

echo "==> Running the test suite"
npm test

cat <<'EOF'

Done. Next steps:
  1. Edit .env                        (DessMonitor login + notifier + thresholds)
  2. npm run list-devices             -> paste the DESS_* values into .env
  3. Notifier:
       WhatsApp -> npm run list-groups   (scan the QR, put WHATSAPP_GROUP_ID in .env)
       Webhook  -> set NOTIFY_DRIVER=webhook and WEBHOOK_URL in .env
  4. npm run send-now                 -> confirm a heartbeat arrives
  5. Install the service:
       sudo cp deploy/solarwatch.service /etc/systemd/system/
       sudo systemctl daemon-reload && sudo systemctl enable --now solarwatch
       journalctl -u solarwatch -f
EOF
