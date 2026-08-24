#!/usr/bin/env bash
# Benchmark against the main branch deployment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$SCRIPT_DIR/benchmark_workflow_executions.mjs" \
  --kibana "https://main.skynetapp.dev" \
  --es "http://192.168.1.7:5005" \
  --user "elastic:1ab1db3e-838a-4b1e-9944-88084c553998" \
  --count 10000 \
  "$@"
