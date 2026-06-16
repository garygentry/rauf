#!/bin/bash
# Target binary for the reserved generic-cli adapter, driven via a providerConfig
# such as { "binary": "<abs path to this file>", "promptDelivery": "stdin",
# "nonInteractive": ["--auto-approve"] }. It drains stdin (the prompt is delivered
# on stdin), emits plain text, and ends with a final-line RAUF_DONE — no
# stream-json telemetry, proving the config-driven, no-code path end-to-end.
cat > /dev/null
printf '%s\n' "Generic CLI agent ran the iteration to completion."
printf '%s\n' "RAUF_DONE"
