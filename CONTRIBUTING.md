# Contributing to H3 Protocol

The H3 protocol is the single source of truth for all H3 SDKs and the Hermes shim. Every change here cascades to three SDK codebases and the Hermes plugin. Changes must be deliberate, validated, and backward-compatible (or explicitly breaking with a migration path).

## Development Workflow

### 1. Make Schema Changes

Edit `h3-protocol.yaml` and/or files under `schemas/v1/`. Follow these rules:

- New fields must be optional or have sensible defaults — never break existing harnesses
- New decision types get a schema file in `schemas/v1/` and an entry in the `decision` oneOf union
- Error responses follow the standard `error-response.json` shape
- All `$ref` paths are relative (`./schemas/v1/...`)

### 2. Add Example Payloads

Every new request/response type needs at least one valid example in `examples/`. Examples are validated against schemas in CI — they must pass.

### 3. Validate Locally

```bash
bash tests/validate-schemas.sh
```

This runs three checks:
- `ajv` — validates every schema file and example payload
- `redocly lint` — lints the OpenAPI spec
- Round-trip verification — cross-language wire format consistency

All three must pass before opening a PR.

### 4. Update the Compatibility Matrix

If your change affects protocol versioning, update `versions.yaml`:
- New protocol version → new entry in `hermes_versions`
- MAJOR bump → update `sdk_versions` with new SDK target versions
- Deprecation → update `deprecation_policy` if timeline changes

### 5. Open a PR

Push to a feature branch and open a PR against `main`. CI runs:
- `validate-schemas.sh` (must pass)
- `round-trip.js` (must pass)

### 6. Tag a Release

After merge, tag with semantic versioning:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The tag triggers downstream `sync-protocol` workflows in all three SDK repos via `repository_dispatch`.

## Schema Design Rules

### Backward Compatibility

- Adding optional fields: safe, no version bump needed
- Adding new endpoints: safe, PATCH bump
- Adding new decision types: safe, MINOR bump (new capability)
- Removing fields: MAJOR bump, needs migration guide
- Renaming fields: MAJOR bump, needs bridge adapter
- Changing field types: MAJOR bump, needs bridge adapter

### Naming Conventions

- Schema files: kebab-case, `.json` extension
- Properties: snake_case
- Enums: UPPER_SNAKE_CASE for values
- Endpoints: `/v{major}/{resource}`

### Required Fields

Every object schema MUST document which fields are required vs optional. Use the `required` array in JSON Schema. Fields that are always present (like `session_id`) are required. Fields that may be absent (like `tool_results` on first turn) are optional.

## Review Checklist

Before approving a protocol change, verify:

- [ ] `bash tests/validate-schemas.sh` passes (23/23 checks)
- [ ] New types have example payloads
- [ ] Existing example payloads still validate
- [ ] `versions.yaml` updated if version changed
- [ ] No required fields removed without MAJOR bump
- [ ] Error responses documented for new endpoints
- [ ] `h3-protocol.yaml` passes `redocly lint`

## Questions?

See the umbrella project at [get-h3/h3](https://github.com/get-h3/h3) for architecture, specs, and the cross-repo task board.
