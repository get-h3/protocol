# PROTO-DF-02 — minimal harness example, live verification

Verifies `examples/minimal-harness.py` (147 lines, single file) against the three core
H3 endpoints on 2026-09-22 in the worktree `/home/kara/worktrees/protocol-PROTO-DF-02`
(branch `wt/PROTO-DF-02`). Every body below is the verbatim `curl` output of that run —
nothing here is hand-written. md5 of each captured body is recorded so a re-run can be
compared byte-for-byte.

## How it was run

```bash
cd /home/kara/worktrees/protocol-PROTO-DF-02
PORT=9199 uv run --with fastapi --with uvicorn python examples/minimal-harness.py
```

The example defaults to `127.0.0.1:9191` (`h3-protocol.yaml` → `servers`) and reads
`HOST`/`PORT` from the environment. `PORT=9199` was used here only because the local
h3 shim already holds 9191 on this box (it was left running and untouched — see
"Port hygiene"). Server startup line, verbatim:

```
INFO:     Started server process [3188146]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:9199 (Press CTRL+C to quit)
```

## Probe results

| # | Probe | HTTP | Body md5 |
|---|---|---|---|
| 1 | `GET /v1/health` | 200 | `269e6374eec5a885eb136dcad8992ace` |
| 2 | `POST /v1/process` (demo payload, session `s_demo1`) | 200 | `b5f533a418436c3f547246b4db2daed0` |
| 3 | `POST /v1/result` #1 (`decision_id` from probe 2) | 200 | `d2d31b90c442ee879f76f552aa02970d` |
| 4 | `POST /v1/result` #2 (`decision_id` from probe 3) | 200 | `dd1e2dd4e90ba02c29086619aefdbcb2` |
| 5 | `POST /v1/process` with this repo's own `examples/process-request.json` | 200 | `942d98fa25027b4307540e5bffb3df17` |
| 6 | `POST /v1/result` with an unknown session | 404 | `1a7e33007d20ab13e6a8850610ffc121` |
| 7 | `POST /v1/process` missing required members | 400 | `843840e0f3e26731a58170af1a18e6af` |

Server access log for the same run (uvicorn's own lines):

```
INFO:     127.0.0.1:33420 - "GET /v1/health HTTP/1.1" 200 OK
INFO:     127.0.0.1:33424 - "POST /v1/process HTTP/1.1" 200 OK
INFO:     127.0.0.1:33438 - "POST /v1/result HTTP/1.1" 200 OK
INFO:     127.0.0.1:33442 - "POST /v1/result HTTP/1.1" 200 OK
INFO:     127.0.0.1:33452 - "POST /v1/process HTTP/1.1" 200 OK
INFO:     127.0.0.1:33456 - "POST /v1/result HTTP/1.1" 404 Not Found
INFO:     127.0.0.1:33458 - "POST /v1/process HTTP/1.1" 400 Bad Request
```

## Raw bodies

**1 — `GET /v1/health` → 200** (matches `schemas/v1/health-response.json`:
`status: ok` + `protocol_version`)

```json
{"status":"ok","version":"1.0.0","transport":"rest","protocol_version":"1.0","uptime_seconds":11,"active_sessions":0,"capabilities":["text","end"]}
```

Request for 2–4 (the demo payload, also kept as `/tmp/proto-df-02/process-demo.json`):

```json
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
```

**2 — `POST /v1/process` → 200** — a `text` Decision carrying the received history.
`decision_id` is server-assigned (`d_` + 8 hex chars).

```json
{"decision_id":"d_f9fbc034","decision":"text","text":{"content":"Echo: hello h3","finished":false},"history":[{"role":"user","content":"first turn"},{"role":"assistant","content":"first reply"}]}
```

**3 — `POST /v1/result` #1 → 200** — request was
`{"session_id":"s_demo1","decision_id":"d_f9fbc034","result":{"type":"text_sent","success":true}}`.

```json
{"decision_id":"d_3bc02e41","decision":"text","text":{"content":"Result received: text_sent for d_f9fbc034","finished":false}}
```

**4 — `POST /v1/result` #2 → 200** — request was
`{"session_id":"s_demo1","decision_id":"d_3bc02e41","result":{"type":"text_sent","success":true}}`;
the second callback ends the session with `end`/`task_complete` (the `reason` vocabulary
of `schemas/v1/end.json`).

```json
{"decision_id":"d_8e0a6288","decision":"end","end":{"reason":"task_complete","summary":"echo harness finished after 2 result callbacks"}}
```

**5 — `POST /v1/process` accepting this repo's own canonical example** →
`curl --data-binary @examples/process-request.json`. The harness takes the repo's own
example payload unchanged (it declares every required member of `common.json`
`Context`/`Message`/`Identity`; unread optional members pass through).

```json
{"decision_id":"d_c03e03cd","decision":"text","text":{"content":"Echo: Deploy the auth endpoint to staging","finished":false},"history":[{"role":"user","content":"What's the auth endpoint status?"},{"role":"assistant","content":"It's defined in /app/auth but not deployed yet."}]}
```

**6 — `POST /v1/result` with an unknown `session_id` → 404** — `SESSION_NOT_FOUND`
(404 per `h3-protocol.yaml` → `components.responses.SessionNotFound`).

```json
{"error":{"code":"SESSION_NOT_FOUND","message":"unknown session_id 's_nope'"}}
```

**7 — `POST /v1/process` with `{"session_id":"s_bad","message":{"role":"user","content":"x"}}` → 400** —
`INVALID_REQUEST` (400 per `components.responses.BadRequest`), with the per-field detail
under `details`.

```json
{"error":{"code":"INVALID_REQUEST","message":"request body failed schema validation","details":{"fields":[{"loc":["body","message","timestamp"],"msg":"Field required","type":"missing"},{"loc":["body","identity"],"msg":"Field required","type":"missing"},{"loc":["body","context"],"msg":"Field required","type":"missing"}]}}}
```

## Cross-check: live bodies vs this repo's own schemas

Every captured body (requests and responses) was validated against the schema it claims
to be, using **this repo's own Ajv instance** — ajv-cli's factory module
(`tests/node_modules/ajv-cli/dist/commands/ajv.js`) with the gate's argv
(`--spec=draft2020 --strict=false --all-errors`), i.e. `tests/validate-all.js`'s setup,
not a hand-rolled `new Ajv2020(...)`:

```
VALID    process-demo.json        vs  schemas/v1/process-request.json
VALID    result-1-body.json       vs  schemas/v1/result-request.json
VALID    result-2-body.json       vs  schemas/v1/result-request.json
VALID    health.json              vs  schemas/v1/health-response.json
VALID    process.json             vs  schemas/v1/decision.json
VALID    result-1.json            vs  schemas/v1/decision.json
VALID    result-2-end.json        vs  schemas/v1/decision.json
VALID    process-canonical.json   vs  schemas/v1/decision.json
VALID    unknown-session.json     vs  schemas/v1/error-response.json
VALID    bad-request.json         vs  schemas/v1/error-response.json

10/10 captured bodies validate against this repo's schemas
```

(ajv prints `unknown format "uri"/"date-time" ignored` to stderr for `wait.json` /
`common.json` — that is the same benign message the gate emits, because the CLI factory
registers no format plugins.)

The decision bodies validate against `decision.json` **with** the echoed `history`
member: `decision.json` declares no `additionalProperties: false`, so echoing the
received history is a schema-valid extension. Probes 2–4 each match exactly one `oneOf`
branch (`text`, `text`, `end`) — a second branch would fail `oneOf`.

## Reproduce

```bash
cd /home/kara/worktrees/protocol-PROTO-DF-02
mkdir -p /tmp/proto-df-02
PORT=9199 uv run --with fastapi --with uvicorn python examples/minimal-harness.py &
# wait for the port
until curl -s -o /dev/null http://127.0.0.1:9199/v1/health; do sleep 1; done
curl -s http://127.0.0.1:9199/v1/health
DID=$(curl -s -X POST http://127.0.0.1:9199/v1/process -H 'Content-Type: application/json' \
        --data-binary @/tmp/proto-df-02/process-demo.json | python3 -c 'import json,sys;print(json.load(sys.stdin)["decision_id"])')
curl -s -X POST http://127.0.0.1:9199/v1/result -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"s_demo1\",\"decision_id\":\"$DID\",\"result\":{\"type\":\"text_sent\",\"success\":true}}"
kill %1
```

## Port hygiene and gate

- After `kill`, port 9199 is free (`ss -ltnp` shows no listener; `curl` to it returns
  `000` = connection refused) and no `minimal-harness` process is left behind.
- Port 9191 was **not** touched: it is held by the pre-existing h3 shim
  (`/home/kara/get-h3/shim/.venv/bin/python main.py`), still listening afterwards.
- `bash tests/validate-schemas.sh` — **56 checks, 56 passed, 0 failed** (before and
  after adding `examples/minimal-harness.py`; the pinned floor in the gate is
  `GATE_CHECK_FLOOR=56`). The gate's example corpus comes from explicit tables plus
  `examples/decisions/*.json`, so a `.py` file under `examples/` is not treated as an
  example payload and does not change the count.
- Field-name cross-check of everything documented in `README.md`'s "Minimal harness
  example" against `schemas/v1/*.json`: `status`, `version`, `transport`,
  `protocol_version`, `uptime_seconds`, `active_sessions`, `capabilities`;
  `session_id`, `message`, `identity`, `context`, `decision_id`, `result`, `type`,
  `success`, `decision`, `text`, `content`, `finished`, `end`, `reason`, `history`,
  `role`, `tools`, `models`, `config`, `session_state`, `max_iterations`,
  `timeout_seconds`, `turn_count`, `total_tool_calls`, `total_llm_calls`,
  `cost_so_far`, `started_at`, `timestamp`, `platform`, `chat_id`, `user_name`,
  `user_id`, `error`, `code`, `message`, `details` — all are properties of the schema
  files named in the section (`health-response.json`, `process-request.json`,
  `common.json`, `decision.json`, `text-response.json`, `end.json`,
  `result-request.json`, `error-response.json`), and `task_complete` is a member of
  `end.json`'s `reason` enum. `protocol_version` is the schema's spelling — there is no
  `protocolVersion` property in `health-response.json`.
