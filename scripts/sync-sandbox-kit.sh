#!/bin/sh
# Co·labr runs the sandbox kit like any other project would: from copies.
# Edit sandbox-kit/, then run this so the installed copies match. The one file
# that is NOT copied is netlify/functions/sandbox.config.json — that is Co·labr's
# own configuration and each project keeps its own.
set -e
cd "$(dirname "$0")/.."
cp sandbox-kit/_sandbox.js       netlify/functions/_sandbox.js
cp sandbox-kit/sandbox-report.js netlify/functions/sandbox-report.js
cp sandbox-kit/sandbox-widget.js sandbox-widget.js
cp sandbox-kit/sandbox-board.html sandbox-board.html
echo "Sandbox kit synced. Co·labr's own settings stay in netlify/functions/sandbox.config.json."
