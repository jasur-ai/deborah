#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Edikit — Gate 0 Verification Runner
# ═══════════════════════════════════════════════════════════════
# Runs all verification gates required for Phase A release:
#   1. Answer-key secret scan (CI gate)
#   2. TypeScript typecheck
#   3. Unit tests
#   4. Integration tests (HTTP, health, socket, gate-0-security)
#   5. Full test suite
#   6. XSS security tests
#
# Usage:
#   bash scripts/gate-0-verify.sh
#
# Exit codes:
#   0 — All gates pass
#   1 — One or more gates fail
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PASS=0
FAIL=0
RESULTS=()

log_pass() { echo -e "  [✅ PASS] $1"; PASS=$((PASS+1)); RESULTS+=("PASS: $1"); }
log_fail() { echo -e "  [❌ FAIL] $1"; FAIL=$((FAIL+1)); RESULTS+=("FAIL: $1"); }
separator() { echo ""; echo "──────────────────────────────────────────────────"; echo ""; }
run_gate() {
  local name="$1"; shift
  local log_file="/tmp/gate0-$(echo "$name" | tr ' ' '_').log"
  # Run the command, tee to log file. Temporarily disable `set -e` so a failed
  # gate does not abort the script before we capture PIPESTATUS and log it.
  local exit_code=0
  set +e
  "$@" 2>&1 | tee "$log_file"
  exit_code="${PIPESTATUS[0]}"
  set -e
  if [ "$exit_code" -eq 0 ]; then
    log_pass "$name"
  else
    log_fail "$name (exit code: $exit_code)"
  fi
  return 0
}

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║   🔐 Edikit — Gate 0 Verification Suite            ║"
echo "║   $(date '+%Y-%m-%d %H:%M:%S')                              ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ═══════════════════════════════════════════════════════════
# GATE 1: Answer-Key Secret Scan
# ═══════════════════════════════════════════════════════════
echo "📋 GATE 1: Answer-Key Secret Scan"
separator
run_gate "Answer-key scan" node scripts/answer-key-scan.js
separator

# ═══════════════════════════════════════════════════════════
# GATE 2: TypeScript Typecheck
# ═══════════════════════════════════════════════════════════
echo "📋 GATE 2: TypeScript Typecheck"
separator
run_gate "TypeScript typecheck" npx tsc --noEmit
separator

# ═══════════════════════════════════════════════════════════
# GATE 3: Unit Tests
# ═══════════════════════════════════════════════════════════
echo "📋 GATE 3: Unit Tests"
separator
run_gate "Unit tests" npx vitest run tests/unit
separator

# ═══════════════════════════════════════════════════════════
# GATE 4: Integration Tests
# ═══════════════════════════════════════════════════════════
echo "📋 GATE 4: Integration Tests"
separator
run_gate "Integration tests" npx vitest run tests/integration
separator

# ═══════════════════════════════════════════════════════════
# GATE 5: Full Test Suite
# ═══════════════════════════════════════════════════════════
echo "📋 GATE 5: Full Test Suite (all tests)"
separator
run_gate "Full test suite" npx vitest run
separator

# ═══════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════
echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║   📊 Gate 0 Verification Summary                    ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

for r in "${RESULTS[@]}"; do
  echo "  $r"
done

echo ""
echo "──────────────────────────────────────────────────"
echo "  Total: $((PASS+FAIL)) checks | ✅ $PASS passed | ❌ $FAIL failed"
echo "──────────────────────────────────────────────────"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "╔═══════════════════════════════════════════════════════╗"
  echo "║   ✅ GATE 0: ALL CHECKS PASSED                      ║"
  echo "║   Status: READY FOR GATE 1                          ║"
  echo "╚═══════════════════════════════════════════════════════╝"
  exit 0
else
  echo "╔═══════════════════════════════════════════════════════╗"
  echo "║   ❌ GATE 0: $FAIL CHECK(S) FAILED                     ║"
  echo "║   Status: BLOCKED — Gate 1 NOT ready                ║"
  echo "╚═══════════════════════════════════════════════════════╝"
  exit 1
fi
