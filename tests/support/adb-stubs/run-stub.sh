#!/usr/bin/env bash
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
stub="$(basename "$0")"

if command -v bun >/dev/null 2>&1; then
	bun_bin="$(command -v bun)"
elif [[ -x "${HOME:-}/.bun/bin/bun" ]]; then
	bun_bin="${HOME}/.bun/bin/bun"
else
	echo "fake-adb: bun not found" >&2
	exit 127
fi

exec "$bun_bin" "$dir/fake-adb.ts" --stub "$stub" "$@"
