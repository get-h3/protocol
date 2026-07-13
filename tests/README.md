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

### Schema validation + example validation + OpenAPI lint

```bash
bash tests/validate-schemas.sh
```

This does three things:

1. **Schema compilation** — compiles all 14 JSON Schema files (`schemas/v1/*.json`) with `ajv` to verify they are valid schemas
2. **Example validation** — validates every example payload (`examples/`) against its corresponding schema using `ajv`
3. **OpenAPI lint** — lints `h3-protocol.yaml` with `@redocly/cli`

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
| `validate-schemas.sh` | Bash script for schema compilation, example validation, and OpenAPI lint |
| `round-trip.js` | Node.js script for programmatic validation + round-trip consistency checks |
| `package.json` | npm dependencies: `ajv`, `ajv-cli`, `ajv-formats`, `@redocly/cli` |

## Dependencies

All dependencies are installed locally via `npm install` (no global installs needed):

- **ajv** — JSON Schema validator (v8, draft 2020-12)
- **ajv-cli** — CLI tools for ajv (compile, validate)
- **ajv-formats** — Format validators (date-time, uri, etc.)
- **@redocly/cli** — OpenAPI spec linter
