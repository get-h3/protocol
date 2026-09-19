#!/usr/bin/env bash
#===============================================================================
# H3 Protocol — Schema + Example Validation Script
#
# Validates all 15 JSON Schema files, checks all example payloads against their
# schemas, verifies no published schema escapes the gate (STEP 4), and lints the
# OpenAPI spec. Exits 0 on success, non-zero on failure.
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
  test-report.json
)

# Schemas that are ONLY compiled as $ref dependencies of another schema (never
# standalone). Kept explicit so STEP 4 can prove every file on disk is covered
# by one of these lists — a hand-maintained list of what the gate compiles.
REF_SCHEMAS=(
  common.json         # -r of process-request.json
  tool-call.json      # -r of decision.json
  llm-call.json       # -r of decision.json
  text-response.json  # -r of decision.json
  wait.json           # -r of decision.json
  delegate.json       # -r of decision.json
  end.json            # -r of decision.json
)

# Entry schemas compiled with -r dependencies (not standalone, not a -r target).
REF_ENTRY_SCHEMAS=(
  process-request.json  # compiled with -r common.json
  decision.json         # compiled with -r all 6 decision sub-schemas
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

# test-report examples — normal run, then the refused non-H3-target shape
check "validate examples/test-report.json" \
  ajv validate \
    -s "$SCHEMAS_DIR/test-report.json" \
    -d examples/test-report.json \
    "${VALIDATE_OPTS[@]}"

check "validate examples/test-report-not-h3.json" \
  ajv validate \
    -s "$SCHEMAS_DIR/test-report.json" \
    -d examples/test-report-not-h3.json \
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
#   STEP 4 — Schema coverage (anti-rot: no published schema outside the gate)
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  STEP 4: Schema coverage (orphan schema detection)          ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# Every file in schemas/v1/ must appear in STANDALONE_SCHEMAS (compiled on its
# own), REF_ENTRY_SCHEMAS (compiled with -r dependencies) or REF_SCHEMAS (only
# compiled as a $ref dependency of process-request.json / decision.json). A
# schema that is published but never compiled is invisible to every gate — a
# broken edit to it passes silently — so a new schema file that is not wired
# into one of those lists MUST fail here loudly and non-zero.
COVERED_SCHEMAS=" ${STANDALONE_SCHEMAS[*]} ${REF_ENTRY_SCHEMAS[*]} ${REF_SCHEMAS[*]} "

for f in "$SCHEMAS_DIR"/*.json; do
  base="$(basename "$f")"
  case "$COVERED_SCHEMAS" in
    *" $base "*)
      pass "coverage: $base is validated by this script"
      ;;
    *)
      fail "$base — exists in $SCHEMAS_DIR/ but is NOT covered by this script; add it to STANDALONE_SCHEMAS (no external \$ref), REF_ENTRY_SCHEMAS or REF_SCHEMAS (see the compile commands in STEP 1)"
      ;;
  esac
done

# =============================================================================
#   Summary
# =============================================================================
summary
