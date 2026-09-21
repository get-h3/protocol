# H3 Protocol Usage Skill

How to use the H3 protocol repo as a consumer — for agents that land here and
need to build against the spec (SDK authors, harness implementers, shim
maintainers).

## What this repo is

The **single source of truth** for H3 (Hermes Harness Hooks): an OpenAPI 3.1
spec (`h3-protocol.yaml`) plus 17 JSON Schemas (`schemas/v1/`) with gate-
enforced examples (`examples/`). Three SDKs (go/python/typescript) generate
types from these schemas via CI. There is **no runtime here** — no server, no
client, no binary. The product IS the contract.

## The protocol in one paragraph

Two-endpoint loop: Hermes `POST /v1/process` (full context: history, tools,
models, config) → harness returns exactly one **Decision**
(`tool_call|llm_call|text|wait|delegate|end`, discriminated on `decision`,
each branch requires its own object). Hermes executes it and
`POST /v1/result` → next Decision, until `end`. Side doors: `GET /v1/health`
(poll 30 s), `POST /v1/cancel` (user interrupt), `GET|DELETE
/v1/sessions/{id}`. Errors are uniform:
`{"error":{"code","message","details?"}}` with an 8-code enum.

## Entry points

| Want to… | Use |
|---|---|
| See the whole contract | `h3-protocol.yaml` (endpoints, error codes, decision discriminator mapping) |
| Validate payloads | `schemas/v1/*.json` — draft 2020-12, relative refs, `$id`ed |
| Get wire fixtures | `examples/` + `examples/decisions/` (gate-enforced valid) |
| Check compatibility | `versions.yaml` (authoritative Hermes↔shim↔protocol matrix) |
| Run the gate | `make test` (→ `bash tests/validate-schemas.sh`, needs `cd tests && npm install` once) |
| Render docs locally | `./tests/node_modules/.bin/redocly preview-docs h3-protocol.yaml` (pinned 1.x; see Pitfall 1) |

## Working example

A complete scratch harness implementation that drives the full loop and
validates every payload against these schemas is preserved at
`docs/dogfood/2026-09-21-integration.md` (includes the Python registry recipe
for relative refs + draft 2020-12).

## Common pitfalls

1. **`npx @redocly/cli preview-docs` fails** ("Unknown arguments") — the
   unpinned package now resolves to CLI 2.x, which dropped `preview-docs`.
   Use the repo-pinned binary: `./tests/node_modules/.bin/redocly
   preview-docs h3-protocol.yaml --port <free>` (after `cd tests && npm
   install`). Board row DF-01 tracks fixing the README.
2. **Port collisions when previewing** — pick a genuinely free port and
   confirm the log line `Preview server running at http://127.0.0.1:<port>`
   before curling; on a busy fleet host, a 404 from port 8080 may be a
   different service entirely.
3. **The README table is a summary, not the contract.** Example: the README
   quick-reference does not mention that `cancel-response` requires
   `cancelled: bool`. When generating types or hand-building payloads, go to
   `schemas/v1/` — `decision.json` and the response schemas are authoritative.
4. **`text` decisions require `finished`.** `finished:false` = more
   decisions coming via /v1/result; omitting it fails validation.
5. **Draft 2020-12 relative refs** need a registry (see the integration doc
   recipe); raw-dict stores in Python `referencing` fail with
   `'dict' object has no attribute 'pointer'`.

## The right-way patterns

- Emitting a decision? Validate against `schemas/v1/decision.json` in your
  CI. Receiving? Validate against `process-request.json` /
  `result-request.json`. The gate keeps schemas+examples+spec in drift-lock
  (56 checks), so validating against these files can't rot silently.
- Adding a schema? It MUST be validated by the gate (coverage check fails
  otherwise) and needs an example (drift check fails otherwise). Add the
  example first, then the schema.
- Version bumps touch `versions.yaml` — it is the compatibility authority the
  installer reads; release CI dispatches to SDK repos on tags.
