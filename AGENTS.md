# AGENTS.md — H3 Protocol

OpenAPI 3.1 specification and JSON Schema — the single source of truth for the H3 protocol.

All SDKs and the Hermes shim generate types from this spec.

## Files

- `h3-protocol.yaml` — OpenAPI 3.1 spec (all endpoints, schemas, error codes)
- `schemas/` — JSON Schema files for individual types (ProcessRequest, Decision, etc.)
- `examples/` — Valid example payloads for every request/response

## Development

- `openapi-generator validate -i h3-protocol.yaml` before commit
- GitReins quality gate mandatory
- Version tags follow semantic versioning matching protocol version

## Reference

Spec: `get-h3/h3` → `specs/02-Protocol-Specification.md`
