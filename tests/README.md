# H3 Protocol — Validation Suite

This directory contains validation scripts for the H3 Protocol specification.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- npm (ships with Node.js)

## Setup

```bash
# From the repo root, install test dependencies
npm install --prefix tests
```

Or equivalently:

```bash
cd tests && npm install
```

## Running the Test Suite

### Schema validation + example validation + OpenAPI lint + spec drift

```bash
bash tests/validate-schemas.sh
```

This does five things:

1. **Schema compilation** — compiles all 17 JSON Schema files (`schemas/v1/*.json`) with `ajv` to verify they are valid schemas
2. **Example validation** — validates every example payload (`examples/`) against its corresponding schema using `ajv`
3. **OpenAPI lint** — lints `h3-protocol.yaml` with `@redocly/cli`
4. **Coverage check** — fails loudly if a file exists in `schemas/v1/` that the script does not compile (anti-rot: a published schema must never sit outside the gate)
5. **Spec drift check** — runs `node tests/check-spec-drift.js`, which verifies that `h3-protocol.yaml`, `schemas/v1/` and `examples/` still describe the same protocol:
   - every `$ref` in the spec resolves (file exists, `#/fragment` resolves, internal `#/…` resolves)
   - no payload schema is written inline under a path — every request/response media-type schema must be a `$ref` (an inline body shape escapes every schema-level gate)
   - `components.schemas.Decision` is equivalent to `schemas/v1/decision.json` (oneOf target set, discriminator mapping keys/values, per-branch `const`)
   - every `common.json#/definitions/<Name>` `$ref` resolves to an existing definition
   - every file in `schemas/v1/` is either `$ref`-ed from the spec or declared out-of-band with a reason (e.g. `test-report.json`, a CLI artifact rather than an HTTP payload)
   - every file in `schemas/v1/` has a payload example that the gate validates, or is declared example-less with a reason (`common.json` is a definitions bag)

### Round-trip tests

```bash
node tests/round-trip.js
```

This does two things for each example:

1. **Schema validation** — validates the example against the appropriate schema (programmatic ajv)
2. **Round-trip consistency** — parses the JSON, re-serializes it, and verifies the result is semantically identical (deep-equal)

### Run everything

```bash
bash tests/validate-schemas.sh && node tests/round-trip.js
```

Or via npm script:

```bash
npm test --prefix tests
```

## Test Files

| File | Purpose |
|------|---------|
| `validate-schemas.sh` | Bash script for schema compilation, example validation, OpenAPI lint, coverage, and the spec-drift step |
| `check-spec-drift.js` | Node.js drift checker: `h3-protocol.yaml` ↔ `schemas/v1/` ↔ `examples/` (STEP 5) |
| `round-trip.js` | Node.js script for programmatic validation + round-trip consistency checks |
| `package.json` | npm dependencies: `ajv`, `ajv-cli`, `ajv-formats`, `@redocly/cli` |

## Dependencies

All dependencies are installed locally via `npm install` (no global installs needed):

- **ajv** — JSON Schema validator (v8, draft 2020-12)
- **ajv-cli** — CLI tools for ajv (compile, validate)
- **ajv-formats** — Format validators (date-time, uri, etc.)
- **@redocly/cli** — OpenAPI spec linter

`check-spec-drift.js` needs `js-yaml` but adds no dependency: it requires the
copy already present in `tests/node_modules` (a transitive dependency of
`@redocly/cli`) by explicit path, so it runs from any cwd.
