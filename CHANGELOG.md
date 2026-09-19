# Changelog

All notable changes to the H3 Protocol specification.

## [Unreleased]

### Fixed
- `schemas/v1/test-report.json` was published but validated by no gate: it is now
  compiled by `tests/validate-schemas.sh` (STEP 1) and exercised by `tests/round-trip.js`.
- `tests/validate-schemas.sh` STEP 4 (new) fails when a file under `schemas/v1/` is not
  validated by the script, so a new schema can no longer escape the gate silently.
- README and script header schema counts corrected (14 → 15).

### Changed
- `test-report.json` reconciled with the real producer (the `h3-test --json` battery CLI in
  get-h3/shim): documented the `latency` object (min/p50/p90/p95/p99/max/mean ms) and the
  refused-run fields (`warning`, `endpoint`, `not_h3_endpoint`, `reason`). Additive only —
  no new required property, so existing producers and generated SDK types stay valid.
- Added examples `examples/test-report.json` (normal run) and
  `examples/test-report-not-h3.json` (target is not an H3 endpoint), both gate-covered.

## [1.0.0] — 2026-07-19

### Added
- OpenAPI 3.1 specification (h3-protocol.yaml)
- JSON Schema definitions (schemas/v1/)
- ProcessRequest, Decision, Result schemas
- Health, SessionState, Identity, Context schemas
- TestReport schema for compliance reporting
- Security-Authentication.md (S12)
- API key auth model (S13)
- GitReins quality gate
- Hilo code graph
