#!/usr/bin/env bash
#===============================================================================
# H3 Protocol — Schema + Example Validation Script
#
# Validates all 14 JSON Schema files, checks all example payloads against their
# schemas, and lints the OpenAPI spec. Exits 0 on success, non-zero on failure.
#
# Usage:  cd <repo-root> && bash tests/validate-schemas.sh
#===============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# -- counters ----------------------------------------------------------------
TOTAL=0
PASSED=0
FAILED=0

# -- helpers -----------------------------------------------------------------
pass()   { echo "  ✓ PASS: $1"; PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)); }
fail()   { echo "  ✗ FAIL: $1"; FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1)); }

check() {
  local desc="$1"
  shift
  if "$@"; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

summary() {
  echo ""
  echo "========================================"
  echo "  Total: $TOTAL  |  Passed: $PASSED  |  Failed: $FAILED"
  echo "========================================"
  if [ "$FAILED" -eq 0 ]; then
    echo "  All checks passed!"
  else
    echo "  Some checks failed!"
  fi
  exit "$FAILED"
}

# Add local node_modules/.bin to PATH so ajv/redocly resolve directly
export PATH="$SCRIPT_DIR/node_modules/.bin:$PATH"

AJV_OPTS=(
  --spec=draft2020
  --strict=false
  --all-errors
)
VALIDATE_OPTS=("${AJV_OPTS[@]}")
COMPILE_OPTS=("${AJV_OPTS[@]}")

# =============================================================================
#   STEP 1 — Validate JSON Schema files are themselves valid
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  STEP 1: Schema compilation (validate schemas themselves)  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

SCHEMAS_DIR="schemas/v1"

# Schemas with no external $ref — compile standalone
STANDALONE_SCHEMAS=(
  common.json
  result-request.json
  health-response.json
  error-response.json
  cancel-request.json
  session-response.json
  tool-call.json
  llm-call.json
  text-response.json
  wait.json
  delegate.json
  end.json
)

for s in "${STANDALONE_SCHEMAS[@]}"; do
  check "compile $s" ajv compile -s "$SCHEMAS_DIR/$s" "${COMPILE_OPTS[@]}"
done

# process-request.json — $ref to common.json
check "compile process-request.json" \
  ajv compile \
    -s "$SCHEMAS_DIR/process-request.json" \
    -r "$SCHEMAS_DIR/common.json" \
    "${COMPILE_OPTS[@]}"

# decision.json — $ref to all 6 sub-schemas
check "compile decision.json" \
  ajv compile \
    -s "$SCHEMAS_DIR/decision.json" \
    -r "$SCHEMAS_DIR/tool-call.json" \
    -r "$SCHEMAS_DIR/llm-call.json" \
    -r "$SCHEMAS_DIR/text-response.json" \
    -r "$SCHEMAS_DIR/wait.json" \
    -r "$SCHEMAS_DIR/delegate.json" \
    -r "$SCHEMAS_DIR/end.json" \
    "${COMPILE_OPTS[@]}"

# =============================================================================
#   STEP 2 — Validate example payloads against their schemas
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  STEP 2: Example validation                                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# process-request example
check "validate examples/process-request.json" \
  ajv validate \
    -s "$SCHEMAS_DIR/process-request.json" \
    -r "$SCHEMAS_DIR/common.json" \
    -d examples/process-request.json \
    "${VALIDATE_OPTS[@]}"

# result-request example
check "validate examples/result-request.json" \
  ajv validate \
    -s "$SCHEMAS_DIR/result-request.json" \
    -d examples/result-request.json \
    "${VALIDATE_OPTS[@]}"

# All 6 decision examples — each validated against decision.json
DECISION_SUBREFS=(
  -r "$SCHEMAS_DIR/tool-call.json"
  -r "$SCHEMAS_DIR/llm-call.json"
  -r "$SCHEMAS_DIR/text-response.json"
  -r "$SCHEMAS_DIR/wait.json"
  -r "$SCHEMAS_DIR/delegate.json"
  -r "$SCHEMAS_DIR/end.json"
)

for f in examples/decisions/*.json; do
  name="${f#examples/}"
  check "validate $name" \
    ajv validate \
      -s "$SCHEMAS_DIR/decision.json" \
      "${DECISION_SUBREFS[@]}" \
      -d "$f" \
      "${VALIDATE_OPTS[@]}"
done

# =============================================================================
#   STEP 3 — Lint the OpenAPI spec
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  STEP 3: OpenAPI spec lint                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

check "lint h3-protocol.yaml" redocly lint h3-protocol.yaml --config tests/.redocly.yaml

# =============================================================================
#   Summary
# =============================================================================
summary
