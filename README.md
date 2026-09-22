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
├── schemas/v1/               # 17 JSON Schema files (one per type)
│   ├── process-request.json  # Full context: history, tools, models, config
│   ├── decision.json         # Union: text, tool_call, delegate, llm_call, wait, end
│   ├── result-request.json   # Execution result + session state
│   ├── health-response.json  # Status, version, capabilities
│   ├── cancel-response.json  # POST /v1/cancel 200 (cancelled_decision_id may be null)
│   ├── session-terminate-response.json # DELETE /v1/sessions/:id 200
│   ├── test-report.json      # Compliance battery report (h3-test --json output)
│   └── ...                   # Supporting schemas (common, errors, etc.)
├── examples/                 # Valid example payloads for every request/response
│   ├── process-request.json  # Full process request (what the harness receives)
│   ├── minimal-harness.py    # Runnable single-file harness (Python, FastAPI)
│   ├── cancel-response.json  # Cancellation acknowledged
│   ├── session-terminate-response.json # Session terminated
│   ├── test-report.json      # Normal battery report (results + latency stats)
│   ├── test-report-not-h3.json # Battery refused the target (not an H3 endpoint)
│   ├── decisions/            # One example per decision type (6 files)
│   └── ...                   # Plus health-response, error-response, sessions
├── tests/
│   ├── validate-schemas.sh   # The gate: drives the runner, redocly lint, drift check
│   ├── validate-all.js       # In-process schema + example validation (STEP 1/2/4)
│   ├── check-spec-drift.js   # spec ↔ schemas/v1 ↔ examples drift checker (STEP 5)
│   └── round-trip.js         # Cross-language wire format verification
├── versions.yaml             # Hermes ↔ H3 version compatibility matrix
└── AGENTS.md                 # AI agent guidance
```

## Getting Started

### Prerequisites

Install the toolchain in this order — each step is needed by the next.

1. `bash` and `make` — the gate is a bash script, and the repo root carries a `Makefile` that delegates to it (`make test` / `make validate`). That root `Makefile` is the CI and agent-harness entrypoint for this repo.
2. Node.js 22 and npm — CI pins Node 22 (`.github/workflows/validate.yml`, `.github/workflows/release.yml`). `npm` is what installs the test dependencies in the next step.
3. The test dependencies — `ajv` and `redocly` are not installed globally, and nothing installs them for you:

```bash
cd tests && npm install
```

Dependencies live in `tests/package.json` (there is deliberately no root `package.json`). That install provides `ajv` v8 with `ajv-cli` and `ajv-formats`, plus `@redocly/cli` (declared `^1.25.0`).

With those in place the first command below works as written: the gate script adds `tests/node_modules/.bin` to `PATH` itself, so `ajv` and `redocly` resolve from the local install and no global install is needed.

### Validate Everything

```bash
cd protocol/
bash tests/validate-schemas.sh
```

This runs:
1. All 17 JSON Schema files validated with `ajv` (in-process, one Node interpreter — `tests/validate-all.js`)
2. All 16 example payloads checked against their schemas, plus one real `ajv` CLI smoke per group so the CLI path stays covered
3. `redocly lint h3-protocol.yaml` — OpenAPI spec validation
4. A coverage check that fails if a file under `schemas/v1/` is not validated by the gate (no published schema may sit outside the gate)
5. A spec-drift check (`node tests/check-spec-drift.js`) that fails if `h3-protocol.yaml`, `schemas/v1/` and `examples/` disagree — an unresolved `$ref`, a payload schema written inline under a path instead of a `$ref`, a `Decision` union that no longer matches `decision.json`, or a schema file with no example

### View the Spec

```bash
npx -y @redocly/cli@^1.25.0 preview-docs h3-protocol.yaml
# Opens http://127.0.0.1:8080 with interactive API docs
```

The major is pinned (`@^1.25.0` — the same range the gate's own tooling declares in
`tests/package.json`): an unpinned `npx @redocly/cli` now resolves to CLI 2.x, which
removed the `preview-docs` command. Add `--port <port>` if 8080 is already in use.

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

## Minimal harness example

`examples/minimal-harness.py` is a runnable single-file harness (FastAPI, 147 lines) — the
fastest way to see the wire format before writing your own. It needs no shim and no SDK, and
reads no file of this repo at runtime.

```bash
uv run --with fastapi --with uvicorn python examples/minimal-harness.py
# serves http://127.0.0.1:9191 — the port in h3-protocol.yaml `servers`; HOST/PORT override it
```

It answers `GET /v1/health`, then echoes the turn: `POST /v1/process` returns a `text`
Decision carrying the history it received, and the second `POST /v1/result` ends the session
with `end` / `task_complete`. The bodies below are real output from a live run — full
transcript, raw bodies and the schema cross-check are in
[`docs/verification/proto-df-02-minimal-harness.md`](docs/verification/proto-df-02-minimal-harness.md).
That run set `PORT=9199` because a local shim already held the default 9191.

```bash
cat > /tmp/process.json <<'JSON'
{
  "session_id": "s_demo1",
  "message": {"role": "user", "content": "hello h3", "timestamp": "2026-09-22T20:20:00Z"},
  "identity": {"platform": "cli", "chat_id": "c_1", "user_name": "copier", "user_id": "u_1"},
  "context": {
    "history": [
      {"role": "user", "content": "first turn"},
      {"role": "assistant", "content": "first reply"}
    ],
    "tools": [],
    "models": [],
    "config": {"max_iterations": 5, "timeout_seconds": 60},
    "session_state": {"turn_count": 1, "total_tool_calls": 0, "total_llm_calls": 0,
                      "cost_so_far": 0, "started_at": "2026-09-22T20:19:00Z"}
  }
}
JSON

# 1. new user message -> Decision (decision_id is assigned by the harness per decision)
curl -s -X POST http://127.0.0.1:9199/v1/process \
  -H 'Content-Type: application/json' -d @/tmp/process.json
{"decision_id":"d_f9fbc034","decision":"text","text":{"content":"Echo: hello h3","finished":false},"history":[{"role":"user","content":"first turn"},{"role":"assistant","content":"first reply"}]}

# 2. report the execution result -> next Decision
curl -s -X POST http://127.0.0.1:9199/v1/result \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"s_demo1","decision_id":"d_f9fbc034","result":{"type":"text_sent","success":true}}'
{"decision_id":"d_3bc02e41","decision":"text","text":{"content":"Result received: text_sent for d_f9fbc034","finished":false}}
```

The same call with `-d @examples/process-request.json` works unchanged: the harness accepts
this repo's own canonical example payload. Errors come back in the shape of
`schemas/v1/error-response.json` — `400 INVALID_REQUEST` for a body that fails validation,
`404 SESSION_NOT_FOUND` for an unknown `session_id` — with the codes and statuses of
`h3-protocol.yaml` → `x-h3-errors`.

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
