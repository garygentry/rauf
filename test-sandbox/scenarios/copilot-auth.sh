#!/bin/bash
cat > /dev/null
printf '%s\n' "You are not logged in. Please sign in." >&2
exit 1
