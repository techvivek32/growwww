#!/bin/sh
# One-time server setup for the research box (Ubuntu 24.04). Idempotent.
# Code is synced to /opt/mnha-research first (rsync of research/).
set -eu
cd /opt/mnha-research
apt-get install -y -qq python3-venv python3-pip >/dev/null
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
mkdir -p data
.venv/bin/pip freeze > data/pip-freeze.txt

if [ ! -f /etc/mnha-research.env ]; then
  umask 077
  cat > /etc/mnha-research.env <<'EOF'
# Groww Trading API — the same key + TOTP secret as the terminal's house account.
# Market data only: this service has no order code.
GROWW_API_KEY=
GROWW_TOTP_SECRET=
MNHA_RESEARCH_HOME=/opt/mnha-research
MNHA_RESEARCH_DATA=/opt/mnha-research/data
EOF
fi
chmod 600 /etc/mnha-research.env

cp deploy/mnha-research-api.service deploy/mnha-research.service deploy/mnha-research.timer deploy/mnha-paper.service deploy/mnha-paper.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mnha-research-api.service
systemctl enable --now mnha-research.timer
systemctl enable --now mnha-paper.timer
.venv/bin/python -m mnha_research init
echo "setup done"
