# Dogfood Integration Report — 2026-09-21

**Run:** coding-hermes-dogfood cron (real-use depth)
**Target:** get-h3/protocol @ `ef742dcf`
**Verdict:** ✅ **SHIPPABLE** (with two P1 doc findings — see board `DF-01`–`DF-03`)

## What was actually done (the consumer)

A scratch H3 **harness implementation** was written from scratch in
`/tmp/dogfood-h3/consumer/` using only the documented surface (README,
AGENTS.md, `h3-protocol.yaml`, `schemas/v1/*.json`). No repo internals
imported, no test code reused. It implements the receiving end Hermes talks to
and drives the full protocol loop:

```
GET /v1/health
POST /v1/process   → decision: tool_call
POST /v1/result    (tool_result) → decision: text  (finished=false)
POST /v1/result    (text_sent)   → decision: end   (task_complete)
GET /v1/sessions/{id} → session metadata
DELETE /v1/sessions/{id} → terminate
POST /v1/result    on a dead session → 404 error-response (SESSION_NOT_FOUND)
POST /v1/process   missing identity  → 400 error-response (INVALID_REQUEST)
POST /v1/cancel    → cancel-response (cancelled=true, cancelled_decision_id)
```

Every wire payload — requests *and* responses — was validated against the
repo's own JSON Schemas with Python `jsonschema` (draft 2020-12, registry
resolving the repo's relative `$ref`s, format checking on). A negative case
(a `tool_call` decision missing its `tool_call` branch) was proven to be
**rejected** by `decision.json`. Result: **10/10 exchanges valid, 0.03 s
total runtime.**

### How to load these schemas from Python (the non-obvious part)

The schemas use draft **2020-12** with *relative* refs
(`common.json#/definitions/Message`, `tool-call.json`) and full `$id`s. The
working recipe:

```python
import json, pathlib, referencing
from jsonschema import Draft202012Validator

SCHEMA_DIR = pathlib.Path("schemas/v1")
store = {}
def retrieve(uri):
    return store[uri.rsplit("/", 1)[-1]]          # basename lookup
for f in SCHEMA_DIR.glob("*.json"):
    doc = json.loads(f.read_text())
    res = referencing.Resource.from_contents(doc)  # MUST be a Resource, not a dict
    store[f.name] = res
    store[doc["$id"]] = res
reg = referencing.Registry(retrieve=retrieve)

v = Draft202012Validator(json.loads((SCHEMA_DIR / "decision.json").read_text()),
                         registry=reg,
                         format_checker=Draft202012Validator.FORMAT_CHECKER)
v.validate({"decision": "end", "decision_id": "d_1", "end": {"reason": "task_complete"}})
```

Two gotchas hit on the way (both consumer-side, recorded because the next
integrator will hit them too):

1. `referencing.Registry` needs `Resource.from_contents(doc)` — passing raw
   dicts fails with `'dict' object has no attribute 'pointer'`.
2. Old `jsonschema` (<4.18, no `referencing`) can't do draft 2020-12
   registries at all; pin `jsonschema>=4.20`.

## Protocol shape as experienced (what the schemas actually say)

- The **Decision union** discriminates on `decision` and requires the
  matching branch object: `tool_call` → required `tool_call` object
  (`name`, `params`, optional `reasoning`), `text` → required `text` object
  (`content`, **`finished` required**), `end` → required `end` object with
  enum `reason` (`task_complete|user_requested|error|timeout|rate_limited|cancelled`),
  plus `llm_call`, `wait`, `delegate`.
- `text.finished=false` means "more decisions coming via /v1/result" — this
  is how a harness streams several text messages per turn.
- `cancel-response` requires **`cancelled: bool`** next to the nullable
  `cancelled_decision_id` (null is legal *and* the field may be absent — the
  schema description records the shim types it `str | None = None`).
- `result.type` enum is closed:
  `tool_result|llm_response|text_sent|delegate_result|wait_timeout|error`.
- Error envelope is uniform: `{"error": {"code", "message", "details?"}}`
  with a closed 8-code enum matching the `x-h3-errors` block in the YAML.
- `process-request.message.role` is enum `["user"]` only — Hermes is always
  the sender on /v1/process; history roles live in `context.history`.

## Errors hit during real use

| # | Error | Root cause | Fix / lesson |
|---|---|---|---|
| 1 | `Unknown arguments: preview-docs, h3-protocol.yaml` | README's command resolves unpinned `npx @redocly/cli` → **2.53.3** (command surface renamed to `openapi <command>`) | Filed **DF-01**; the pinned 1.34.17 from `tests/package.json` still works: `./tests/node_modules/.bin/redocly preview-docs h3-protocol.yaml` |
| 2 | `HTTP 404` against "the docs page" | Host was busy: ports 8080 *and* 8123 were other services; the 404 was foreign | Check the preview log for `Preview server running at` before curling |
| 3 | `'dict' object has no attribute 'pointer'` | `referencing` registry wants `Resource` objects | Recipe above |
| 4 | cancel response failed repo schema | Consumer (me) built to memory of the README table, not `cancel-response.json` | The schemas are the truth; they were right and self-consistent |

## Install-from-scratch (ephemeral bunker, las-bunker-03)

Fresh Debian user, no toolchains preinstalled, following ONLY the README:

| Step | Result |
|---|---|
| `git clone https://github.com/get-h3/protocol` | OK (public URL, no credentials) |
| `(cd tests && npm install)` | OK in **11 s** (Node 22.23.2, npm 10.9.8 on the box) |
| `bash tests/validate-schemas.sh` | **56/56 checks in 2 s**, exit 0 |

Agent destroyed after the run (`bunker destroy`, verified). Local host numbers
agree: gate 56/56 in 1.35 s, `node tests/round-trip.js` 10/10 in 0.074 s.

## Performance (Step 2b)

| Operation | Cold | Warm (n=20, hyperfine) | Verdict |
|---|---|---|---|
| Gate (`bash tests/validate-schemas.sh`) | 1.35 s | **1.336 s ± 0.019 s** | Fast enough — no row |
| Round-trip (`node tests/round-trip.js`) | 0.074 s | — | Fast enough |
| Consumer loop (10 exchanges, all validated) | 0.03 s | — | Fast enough |

Nothing here is slow enough to be worth a PERF row; no profiling done (per
skill law: a win nobody can feel is not a finding).

## What a new consumer should do (the fast path)

1. Read `README.md` "Decision Types" + `schemas/v1/decision.json` together —
   the union table in the README is a summary, the schema is the contract.
2. Generate or hand-write types from `schemas/v1/` (the three SDKs do this
   from CI — see the SDK table in the README).
3. Validate your emitted decisions against `schemas/v1/decision.json` in CI;
   validate what you receive against `process-request.json`/`result-request.json`.
4. Use `examples/` as wire fixtures — they are gate-enforced to stay valid
   (`round-trip.js`, 10/10).
