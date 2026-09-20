#!/usr/bin/env bash
#===============================================================================
# H3 Protocol — Schema + Example Validation Script
#
# Validates all 17 JSON Schema files, checks all example payloads against their
# schemas, verifies no published schema escapes the gate (STEP 4), checks that
# h3-protocol.yaml / schemas/v1 / examples have not drifted apart (STEP 5), and
# lints the OpenAPI spec. Exits 0 on success, non-zero on failure.
#
# HOST LOAD (P6-03): STEP 1 and STEP 2 used to spawn one `ajv` CLI process per
# assertion. The ajv CLI is a Node script, so every check paid a full Node
# interpreter start — ~33 per gate run — for a check whose subject is the schema
# validation itself, not the process boundary. Those checks are now executed in
# ONE interpreter by tests/validate-all.js, which reports one PASS/FAIL line per
# check back into this script's counters (same descriptions, same count, same
# exit-code semantics; STEP 4's coverage check runs there too, against the same
# corpus tables the compile checks use). Two real `ajv` CLI invocations — the
# parity smokes below — keep the CLI path itself covered. STEP 3 (redocly lint)
# and STEP 5 (spec drift) are unchanged and still run as separate processes.
#
# Nothing is skipped, cached between runs, or validated less strictly: every run
# re-reads every schema and example from disk and compiles/validates all of them.
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

# Number of checks a complete gate run emits, INCLUDING the completeness check
# itself. 52 before the P6-03 host-load change (33 ajv CLI assertions + redocly +
# 17 coverage + drift); 56 after it (the same 33 assertions run in-process, the
# 17 coverage checks, redocly, drift, two ajv CLI parity smokes and two runner
# accounting checks). Pinned on purpose: a check that silently stops running — or
# a runner that dies before emitting — must fail the gate loudly instead of
# reporting a smaller green. Update deliberately when checks are added/removed.
GATE_CHECK_FLOOR=56

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

# Step banners — same boxes, same titles and same widths as before P6-03.
# The title field is padded to 51 characters (inner box width 62) to keep the
# right border aligned.
STEP_TITLES=(
  [1]="Schema compilation (validate schemas themselves)"
  [2]="Example validation"
  [3]="OpenAPI spec lint"
  [4]="Schema coverage (orphan schema detection)"
  [5]="Spec drift (spec ↔ schemas/v1 ↔ examples)"
)

step_banner() {
  local n="$1" title="${STEP_TITLES[$1]}" pad=$((51 - ${#STEP_TITLES[$1]}))
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  printf '║  STEP %s: %s%*s║\n' "$n" "$title" "$pad" ''
  echo "╚══════════════════════════════════════════════════════════════╝"
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

# Kept in lockstep with AJV_CLI_ARGV in tests/validate-all.js: the in-process
# runner must build the same Ajv instance these flags select on the CLI.
AJV_OPTS=(
  --spec=draft2020
  --strict=false
  --all-errors
)
VALIDATE_OPTS=("${AJV_OPTS[@]}")
COMPILE_OPTS=("${AJV_OPTS[@]}")

SCHEMAS_DIR="schemas/v1"

# =============================================================================
#  In-process validation (STEP 1 + STEP 2 + STEP 4) — ONE Node interpreter
# =============================================================================
# tests/validate-all.js owns the schema corpus tables (standalone / $ref-entry /
# $ref-dependency), compiles every schema, validates every example against it and
# proves every file in schemas/v1/ is covered by one of those tables. It prints
#   INFO<TAB><step><TAB><text>
#   CHECK<TAB><step><TAB>PASS|FAIL<TAB><description>[<TAB><detail>]
#   TOTAL<TAB><number of CHECK lines emitted>
# and this script turns those records into its own check counters, so the gate's
# output contract and totals are unchanged. Its stderr is inherited, so ajv's own
# diagnostics ("unknown format ... ignored" under --strict=false) stay visible.
RUNNER_OUT="$(mktemp "${TMPDIR:-/tmp}/h3-validate-all.XXXXXX")"
trap 'rm -f "$RUNNER_OUT"' EXIT

node "$SCRIPT_DIR/validate-all.js" > "$RUNNER_OUT"
RUNNER_RC=$?

# Consume the runner's records into this script's counters, filtered by step, so
# the step banners keep the order below. Prints this script's own ✓/✗ line for
# every CHECK record of that step, in the runner's order, and the runner's INFO
# records (schema … is valid / example … valid) verbatim.
RUNNER_TOTAL=""
RUNNER_CHECKS=0
RUNNER_CONSUMED=0
RUNNER_PROTOCOL_ERRORS=0

consume_step() {
  local want="$1" tag step status desc detail
  while IFS=$'\t' read -r tag step status desc detail; do
    [ "$step" = "$want" ] || continue
    case "$tag" in
      INFO) echo "$status" ;;
      CHECK)
        RUNNER_CONSUMED=$((RUNNER_CONSUMED + 1))
        if [ "$status" = "PASS" ]; then
          pass "$desc"
        else
          fail "$desc"
          [ -n "${detail:-}" ] && echo "      ↳ $detail"
        fi
        ;;
    esac
  done < "$RUNNER_OUT"
}

# Pre-pass: validate the record protocol and account for every record before any
# banner is printed. A record this script does not understand is a gate failure
# (a check that runs but is not counted is invisible) — never a silent skip.
while IFS=$'\t' read -r tag f2 f3 f4 _f5; do
  case "$tag" in
    "") ;;
    INFO)
      case "$f2" in 1|2|4) ;; *) RUNNER_PROTOCOL_ERRORS=$((RUNNER_PROTOCOL_ERRORS + 1)) ;; esac
      ;;
    CHECK)
      RUNNER_CHECKS=$((RUNNER_CHECKS + 1))
      case "$f2" in 1|2|4) ;; *) RUNNER_PROTOCOL_ERRORS=$((RUNNER_PROTOCOL_ERRORS + 1)) ;; esac
      case "$f3" in PASS|FAIL) ;; *) RUNNER_PROTOCOL_ERRORS=$((RUNNER_PROTOCOL_ERRORS + 1)) ;; esac
      [ -n "$f4" ] || RUNNER_PROTOCOL_ERRORS=$((RUNNER_PROTOCOL_ERRORS + 1))
      ;;
    TOTAL) RUNNER_TOTAL="$f2" ;;
    *) RUNNER_PROTOCOL_ERRORS=$((RUNNER_PROTOCOL_ERRORS + 1)) ;;
  esac
done < "$RUNNER_OUT"

# =============================================================================
#   STEP 1 — Validate JSON Schema files are themselves valid
# =============================================================================
step_banner 1
consume_step 1

# Parity smoke: the same compile STEP 1 just performed in-process, executed once
# through the real `ajv` CLI (with -r), so a break in the CLI path this gate used
# to depend on cannot go unnoticed.
check "ajv CLI parity (real exec): compile process-request.json -r common.json" \
  ajv compile \
    -s "$SCHEMAS_DIR/process-request.json" \
    -r "$SCHEMAS_DIR/common.json" \
    "${COMPILE_OPTS[@]}"

# =============================================================================
#   STEP 2 — Validate example payloads against their schemas
# =============================================================================
step_banner 2
consume_step 2

# Parity smoke: the same example validation STEP 2 just performed in-process,
# executed once through the real `ajv` CLI (with -s / -r / -d and the same flags).
check "ajv CLI parity (real exec): validate examples/process-request.json" \
  ajv validate \
    -s "$SCHEMAS_DIR/process-request.json" \
    -r "$SCHEMAS_DIR/common.json" \
    -d examples/process-request.json \
    "${VALIDATE_OPTS[@]}"

# =============================================================================
#   STEP 3 — Lint the OpenAPI spec
# =============================================================================
step_banner 3
check "lint h3-protocol.yaml" redocly lint h3-protocol.yaml --config tests/.redocly.yaml

# =============================================================================
#   STEP 4 — Schema coverage (anti-rot: no published schema outside the gate)
# =============================================================================
# Every file in schemas/v1/ must appear in STANDALONE_SCHEMAS (compiled on its
# own), REF_ENTRY_SCHEMAS (compiled with -r dependencies) or REF_SCHEMAS (only
# compiled as a $ref dependency of process-request.json / decision.json) — all
# three now live in tests/validate-all.js, where the same tables drive both the
# compile checks and this coverage check. A schema that is published but never
# compiled is invisible to every gate — a broken edit to it passes silently — so
# a new schema file that is not wired into one of those lists MUST fail here
# loudly and non-zero.
step_banner 4
consume_step 4

# Runner accounting: the gate may only report PASS for work the runner actually
# did. rc != 0 (could not run), an unparseable record, or a report/consume count
# mismatch fails here — a dead runner must never look like a smaller green gate.
if [ "$RUNNER_RC" -ne 0 ]; then
  fail "in-process runner (node tests/validate-all.js) exited $RUNNER_RC — its checks did NOT run"
elif [ "$RUNNER_PROTOCOL_ERRORS" -ne 0 ]; then
  fail "in-process runner emitted $RUNNER_PROTOCOL_ERRORS unrecognized/unparseable record(s)"
elif [ -z "$RUNNER_TOTAL" ] || [ "$RUNNER_TOTAL" != "$RUNNER_CHECKS" ] || \
     [ "$RUNNER_CHECKS" != "$RUNNER_CONSUMED" ] || [ "$RUNNER_CHECKS" -eq 0 ]; then
  fail "in-process runner check accounting: reported=${RUNNER_TOTAL:-none} parsed=$RUNNER_CHECKS consumed=$RUNNER_CONSUMED"
else
  pass "in-process runner accounted for $RUNNER_CHECKS checks (reported=$RUNNER_TOTAL, consumed=$RUNNER_CONSUMED)"
fi

# =============================================================================
#   STEP 5 — Spec drift (spec ↔ schemas/v1 ↔ examples)
# =============================================================================
step_banner 5

# h3-protocol.yaml is the declared source of truth, but nothing verified that it
# and the schemas/v1 corpus it $refs and the examples/ payloads still agree.
# check-spec-drift.js asserts: every $ref resolves, no payload schema is written
# inline under paths (a shape that would escape every schema-level gate), the
# Decision union matches decision.json, common.json definition refs resolve,
# every passed schema file is referenced or declared out-of-band, and every
# schema file has an example the gate validates. It prints one ✓/✗ line per
# check and exits non-zero on any drift.
check "spec drift checker (spec ↔ schemas/v1 ↔ examples)" node tests/check-spec-drift.js

# =============================================================================
#   Completeness — the gate may not silently shrink
# =============================================================================
# This check counts itself, so a complete run ends with GATE_CHECK_FLOOR checks.
GATE_CHECKS_COMPLETED=$((TOTAL + 1))
if [ "$GATE_CHECKS_COMPLETED" -ge "$GATE_CHECK_FLOOR" ]; then
  pass "gate completeness: $GATE_CHECKS_COMPLETED checks (floor $GATE_CHECK_FLOOR)"
else
  fail "gate completeness: only $GATE_CHECKS_COMPLETED checks ran, expected >= $GATE_CHECK_FLOOR — checks were dropped without failing"
fi

# =============================================================================
#   Summary
# =============================================================================
summary
