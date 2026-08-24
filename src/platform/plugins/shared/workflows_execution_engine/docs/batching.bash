#!/usr/bin/env bash
# Benchmark against the workflows-batching branch deployment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$SCRIPT_DIR/benchmark_workflow_executions.mjs" \
  --kibana "https://workflows-batching.skynetapp.dev" \
  --es "http://192.168.1.7:5007" \
  --user "elastic:1ab1db3e-838a-4b1e-9944-88084c553998" \
  --count 10000 \
  "$@"
