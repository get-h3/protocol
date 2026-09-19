# Changelog

All notable changes to the H3 Protocol specification.

## [Unreleased]

### Added
- `schemas/v1/cancel-response.json` (CancelResponse) and
  `schemas/v1/session-terminate-response.json` (SessionTerminateResponse): the two response
  bodies that existed only as INLINE schemas under `paths` in `h3-protocol.yaml`, and so had
  no schema file and zero coverage by any gate. Both are now `$ref`-ed from their path and
  exposed as `components.schemas.CancelResponse` / `components.schemas.SessionTerminateResponse`
  pass-throughs alongside the existing ten components.
  `cancelled_decision_id` is nullable (`type: ["string", "null"]`) because the reference
  emitter types it `str | None = None` (get-h3/shim, `src/h3_shim/protocol.py`,
  `CancelResponse`); the spec previously required a non-null string, which the emitter can
  violate when nothing was in flight. The shapes themselves are unchanged — only their
  location moved into the schema corpus.
- Payload examples for the surfaces that had none: `examples/cancel-request.json`,
  `examples/cancel-response.json`, `examples/session-response.json`,
  `examples/session-terminate-response.json`, `examples/health-response.json` and
  `examples/error-response.json` — values taken from the protocol specification (§2, §6, §7,
  §9). All six are validated in STEP 2, so every file in `schemas/v1/` now has a
  gate-validated example except `common.json` (a definitions bag with no top-level payload).
- `tests/check-spec-drift.js`, wired as STEP 5 of `tests/validate-schemas.sh`: a drift
  checker that fails the gate when `h3-protocol.yaml`, `schemas/v1/` and `examples/` disagree.
  It asserts that every `$ref` resolves (file + `#/fragment` + internal), no payload schema is
  written inline under `paths` or `components.responses`, `components.schemas.Decision` is
  equivalent to `schemas/v1/decision.json`, every `common.json#/definitions/<Name>` `$ref`
  resolves, every schema file is referenced from the spec or declared out-of-band
  (`test-report.json` = CLI battery artifact), and every schema file has an example the gate
  actually validates. No new npm dependency: it requires the `js-yaml` already present under
  `tests/node_modules` by explicit path.

### Fixed
- `schemas/v1/test-report.json` was published but validated by no gate: it is now
  compiled by `tests/validate-schemas.sh` (STEP 1) and exercised by `tests/round-trip.js`.
- `tests/validate-schemas.sh` STEP 4 (new) fails when a file under `schemas/v1/` is not
  validated by the script, so a new schema can no longer escape the gate silently.
- README and script header schema counts corrected (14 → 15), then to 17 with the two new
  response schemas.

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
