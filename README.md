# H3 Protocol — Single Source of Truth

OpenAPI 3.1 specification and JSON Schema for the H3 (Hermes Harness Hooks) protocol — the neural link between Hermes Core and external agent harnesses.

H3 is a two-endpoint protocol: Hermes sends a message, the harness returns a Decision. Hermes executes it, sends the result back, and the harness returns the next Decision. The loop continues until the harness ends the session.

## Quick Reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/health` | GET | Harness health check (polled every 30s) |
| `/v1/process` | POST | New message → Decision |
| `/v1/result` | POST | Execution result → next Decision |

## Repository Structure

```
protocol/
├── h3-protocol.yaml          # OpenAPI 3.1 — all endpoints, schemas, error codes
├── schemas/v1/               # 14 JSON Schema files (one per type)
│   ├── process-request.json  # Full context: history, tools, models, config
│   ├── decision.json         # Union: text, tool_call, delegate, llm_call, wait, end
│   ├── result-request.json   # Execution result + session state
│   ├── health-response.json  # Status, version, capabilities
│   └── ...                   # Supporting schemas (common, errors, etc.)
├── examples/                 # Valid example payloads for every request/response
├── tests/
│   ├── validate-schemas.sh   # Validates all schema/example pairs + redocly lint
│   └── round-trip.js         # Cross-language wire format verification
├── versions.yaml             # Hermes ↔ H3 version compatibility matrix
└── AGENTS.md                 # AI agent guidance
```

## Getting Started

### Validate Everything

```bash
cd protocol/
bash tests/validate-schemas.sh
```

This runs:
1. `redocly lint h3-protocol.yaml` — OpenAPI spec validation
2. All 14 JSON Schema files validated with `ajv`
3. All example payloads checked against their schemas

### View the Spec

```bash
npx @redocly/cli preview-docs h3-protocol.yaml
# Opens http://127.0.0.1:8080 with interactive API docs
```

## Decision Types

The harness returns exactly one Decision per call. Six types exist:

| Type | Purpose |
|---|---|
| `text` | Send a text response to the user |
| `tool_call` | Ask Hermes to execute a tool |
| `delegate_task` | Spawn a sub-agent |
| `llm_call` | Ask Hermes to call another LLM |
| `wait` | Wait for user input (interactive mode) |
| `end` | End the session |

## Version Compatibility

`versions.yaml` is the authoritative compatibility matrix. Key rules:

- Hermes 0.18.0 → H3 Shim 1.0.0, Protocol 1.0
- Protocol 1.0 harnesses work with all Hermes 1.x
- Protocol 2.0 (planned) gets a bridge adapter for 1.0 harnesses
- MAJOR versions supported for 6 months after successor release

## SDK Consumers

This repo is the upstream source for three SDKs that generate types from these schemas:

| SDK | Language | Repo |
|---|---|---|
| sdk-go | Go | [get-h3/sdk-go](https://github.com/get-h3/sdk-go) |
| sdk-python | Python | [get-h3/sdk-python](https://github.com/get-h3/sdk-python) |
| sdk-typescript | TypeScript | [get-h3/sdk-typescript](https://github.com/get-h3/sdk-typescript) |

When the protocol changes, downstream SDKs regenerate via their `sync-protocol` CI workflows.

## Release Pipeline

1. PR merged to `main`
2. CI validates schemas, examples, and lint
3. Tag with semantic version: `git tag v1.0.0 && git push --tags`
4. Tag triggers downstream SDK `sync-protocol` workflows via `repository_dispatch`

## Contributing

Schema changes MUST:
- Pass `bash tests/validate-schemas.sh`
- Include example payloads for new types
- Update `versions.yaml` if compatibility changes
- Not break existing example payloads (round-trip test)

See the umbrella project at [get-h3/h3](https://github.com/get-h3/h3) for the full specification and architecture.
