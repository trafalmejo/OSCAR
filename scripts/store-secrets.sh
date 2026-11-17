#!/usr/bin/env bash
# The three repository secrets the release workflow's "Microsoft Store" job
# needs, set from the maintainer's own file outside the repo
# (../secrets/microsoft-store/store.env: MS_STORE_TENANT_ID,
# MS_STORE_CLIENT_ID, MS_STORE_CLIENT_SECRET, one NAME=value per line), and
# the variable that switches the job on. No value is printed. Run it in Git
# Bash, signed in to gh as the repository's owner; again when the key changes.
set -euo pipefail
repo="trafalmejo/OSCAR"
file="$(cd "$(dirname "$0")/../.." && pwd)/secrets/microsoft-store/store.env"
[ -f "$file" ] || { echo "Missing $file" >&2; exit 1; }
for name in MS_STORE_TENANT_ID MS_STORE_CLIENT_ID MS_STORE_CLIENT_SECRET; do
  value="$(grep "^$name=" "$file" | head -1 | cut -d= -f2- | tr -d '\r\n')"
  [ -n "$value" ] || { echo "$name is empty in $file" >&2; exit 1; }
  printf '%s' "$value" | gh secret set "$name" -R "$repo"
done
gh variable set STORE_SUBMIT_READY -R "$repo" --body true
gh secret list -R "$repo" | grep MS_STORE
