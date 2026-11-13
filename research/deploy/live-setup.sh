#!/bin/sh
# Live PAPER trading on the research box (no orders are ever sent). Idempotent.
# Run after setup.sh, with the code synced to /opt/mnha-research:
#   sh deploy/live-setup.sh
set -eu
cd /opt/mnha-research
set -a; . /etc/mnha-research.env; set +a
.venv/bin/python -m mnha_research init
.venv/bin/python -m mnha_research nse-update
.venv/bin/python -m mnha_research ingest --intervals 1440,5 --ignore-market-hours
.venv/bin/python -m mnha_research lab-build
.venv/bin/python -m mnha_research live-train
.venv/bin/python -m mnha_research livex-train
cp deploy/mnha-live-prepare.service deploy/mnha-live-prepare.timer \
   deploy/mnha-live-decide.service deploy/mnha-live-decide.timer \
   deploy/mnha-live-settle.service deploy/mnha-live-settle.timer \
   deploy/mnha-livex-decide.service deploy/mnha-livex-decide.timer deploy/mnha-livex-flip.service deploy/mnha-livex-flip.timer \
   deploy/mnha-livex-settle.service deploy/mnha-livex-settle.timer deploy/mnha-livex-mark.service deploy/mnha-livex-mark.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mnha-live-prepare.timer mnha-live-decide.timer mnha-live-settle.timer mnha-livex-decide.timer mnha-livex-flip.timer mnha-livex-settle.timer mnha-livex-mark.timer
systemctl list-timers 'mnha-live*'
echo "live paper trading scheduled: prepare 08:10, decide 09:17 (waits for 09:20), settle 15:25 IST, Mon-Fri"
