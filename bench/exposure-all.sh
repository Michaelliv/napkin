#!/usr/bin/env bash
# Score overview keyword exposure across every KB in data-kbs/.
# Usage: bash bench/exposure-all.sh
set -euo pipefail

for kb in data-kbs/*/; do
  name=$(basename "$kb")
  echo "════════════════════════════════════════════════════════"
  echo "KB: $name"
  echo "════════════════════════════════════════════════════════"
  if [ ! -d "$kb/.napkin" ]; then
    echo "  (no .napkin/ — initializing)"
    bun src/main.ts init --path "$kb" || {
      echo "  init failed, skipping"
      continue
    }
  fi
  bun bench/overview-exposure.ts "$kb" "$@"
  echo ""
done
