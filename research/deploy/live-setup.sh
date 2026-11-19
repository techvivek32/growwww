#!/bin/sh
# Live PAPER trading on the research box (no orders are ever sent). Idempotent.
# Run after setup.sh, with the code synced to /opt/mnha-research:
#   sh deploy/live-setup.sh
set -eu
cd /opt/mnha-research
# The session loop (09:12-15:30) is the one livex runner: it decides, checks book B's stops,
# flips, marks and settles. The single-step livex timers ran the same steps beside it and
# overwrote its results, so they are switched off FIRST (a later step that fails, such as an
# incomplete nse-history, must not leave them running); their commands remain for manual use.
systemctl disable --now mnha-livex-decide.timer mnha-livex-flip.timer mnha-livex-settle.timer mnha-livex-mark.timer 2>/dev/null || true
set -a; . /etc/mnha-research.env; set +a
.venv/bin/python -m mnha_research init
.venv/bin/python -m mnha_research nse-history  # a new host: NSE membership and history (resumable)
.venv/bin/python -m mnha_research nse-update
.venv/bin/python -m mnha_research ingest --intervals 1440,5 --ignore-market-hours
.venv/bin/python -m mnha_research lab-build
.venv/bin/python -m mnha_research live-train
.venv/bin/python -m mnha_research livex-train
cp deploy/mnha-live-prepare.service deploy/mnha-live-prepare.timer \
   deploy/mnha-live-decide.service deploy/mnha-live-decide.timer \
   deploy/mnha-live-settle.service deploy/mnha-live-settle.timer \
   deploy/mnha-livex-decide.service deploy/mnha-livex-decide.timer deploy/mnha-livex-flip.service deploy/mnha-livex-flip.timer \
   deploy/mnha-livex-settle.service deploy/mnha-livex-settle.timer deploy/mnha-livex-mark.service deploy/mnha-livex-mark.timer \
   deploy/mnha-livex-session.service deploy/mnha-livex-session.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mnha-live-prepare.timer mnha-live-decide.timer mnha-live-settle.timer mnha-livex-session.timer
systemctl list-timers 'mnha-live*'
echo "live paper trading scheduled (IST, Mon-Fri): prepare 08:10; live books decide 09:17, settle 15:25; livex session 09:12-15:30 (decide 09:20, flip 10:15, settle 15:17)"
