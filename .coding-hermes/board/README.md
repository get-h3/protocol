# H3 Protocol foreman board (JSONL)

The canonical task board for `get-h3/protocol`, consumed by the coding-hermes
foreman lane that owns this repo. It is a plain-text, git-tracked store: four
newline-delimited JSON (JSONL) files under `.coding-hermes/board/`. There is no
database and no cache — what git tracks *is* the board.

Bootstrapped 2026-09-18 by the `H3-PM-004` worker (get-h3 umbrella board). The
previous board, `.coding-hermes/tasks.md`, is **preserved unchanged** as the
historical task record; its single completed row `P5-01` was migrated here with
its title, completion commit `2ff3a7c5` and meaning intact (see `events.jsonl`
id 1, `board_migration`).

## Files

| File | Role |
|---|---|
| `tasks.jsonl` | **Canonical** task store. One task object per line. Read by the scheduler's cooldown policy and board-wake reader. |
| `events.jsonl` | Append-only audit log. Never rewritten or reordered. |
| `board.jsonl` | Single header object: project/namespace identity, tick counters, drift pointer (`last_commit`). |
| `fixtures.jsonl` | Perpetual fixture rows (`NEVER-DONE`): always on the board, never completed, excluded from adaptive speed control (SCHED-GAP-106). |

## Format rules

- Exactly one JSON object per line, LF-terminated. No blank lines, no
  pretty-printing, no trailing commas, no comments.
- `events.jsonl` is append-only; `id` is monotonic (`max(id) + 1`).
- Every file starts with `{` and every line parses standalone as JSON.
- Writes go through `boardctl` (below), which enforces the vocabularies. Do not
  hand-edit `tasks.jsonl`/`events.jsonl`.
- No `.db`, `.parquet` or other binary caches are tracked (`boardctl doctor`
  checks the git tracked-set).

## `tasks.jsonl` fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | Required. Fleet convention `PREFIX-NUM` (`P5-01`); fixtures use their own id. |
| `title` | string | Required, one line. |
| `status` | enum | `pending`, `in_progress`, `review`, `blocked`, `complete`, `failed`. |
| `priority` | enum | `P0`–`P3` (`P0` = highest). |
| `complexity` | int | `1`–`5`. |
| `depends_on`, `blocks` | array of ids | Dependency edges. |
| `capability_tags` | array of strings | e.g. `ci,release,workflow`. |
| `reasoning` | string \| null | Why the row exists / how it was derived. |
| `status`/`worker_status` | enum | `worker_status` mirrors the worker lifecycle (`pending`/`complete`/…). |
| `commit_hash` | string \| null | The commit that satisfies the row. |
| `guard_result` | enum | `PASS`, `FAIL`, `SKIP` or null (no gate evidence). |
| `ci_result` | enum | `GREEN`, `RED`, `SKIP` or null. |
| `files_changed`, `lines_added`, `lines_removed` | array/int | Change telemetry when recorded. |
| `attempts`, `exit_code`, `dispatched_at` | int/string | Dispatch telemetry. |
| `worker_summary` | string \| null | One-line outcome. |
| `foreman_note` | string \| null | Foreman's notes; carries preserved history for migrated rows. |
| `blocked_reason` | string \| null | Set when `status = blocked`. |
| `review_notes` | string \| null | Judge/review notes. |
| `perpetual` | bool \| null | `true` = fixture row that must never be completed. |
| `created_at`, `updated_at`, `completed_at`, `blocked_since` | RFC3339 timestamp | Lifecycle timestamps. |

## `events.jsonl` fields

| Field | Type | Notes |
|---|---|---|
| `id` | int | Sequential; `max(id) + 1`. |
| `timestamp` | RFC3339 | Write time (UTC). |
| `event_type` | enum | `audit`, `board_bootstrap`, `board_init`, `board_migration`, `dogfood`, `e2e_verified`, `idle`, `spec_created`, `task_added`, `task_completed`, `task_created`, `task_dispatched`, `task_evidence`, `task_started`, `task_updated`, `task_verified`, `tick`, `worker_dispatched`. |
| `task_id` | string \| `""` | Empty for board-level events. |
| `actor` | string | Who wrote it (`foreman`, the tick id, a bootstrap task id, …). |
| `detail` | string \| null | A JSON document serialized as a string. |
| `tick_number` | int \| null | Foreman tick number, when known. |

## `board.jsonl` header fields

`project`, `namespace` (display identity), `version` (schema generation — 2 for
JSONL-canonical boards), `last_tick`, `ticks_total`, `ticks_idle`,
`cooldown_s`, `service_port`, `service_url`, `health_endpoint`, `git_branch`,
`git_remote`, `last_commit` (board-edit drift pointer, re-pinned by the foreman
after each board commit), `updated_at`.

## Reading and writing

```bash
# read (any of these -C forms: repo root, .coding-hermes, or .coding-hermes/board)
boardctl -C . validate          # JSONL parse + header + id checks
boardctl -C . doctor            # validate + git tracked-set + counter/fixture checks
boardctl -C . list              # open rows (filter: --status, --priority)
boardctl -C . list --all        # every row including complete
boardctl -C . show P5-01 --events
boardctl -C . stats --all

# write (foreman loop)
boardctl -C . create --id P5-02 --title "..." --priority P2 --complexity 3
boardctl -C . update P5-02 --status complete --commit-hash <sha> --guard PASS --ci GREEN
boardctl -C . event --type audit --actor foreman --tick N --detail-text '<json>'
boardctl -C . header --set-ticks-total N --set-last-commit <sha>
```

Exit codes: `0` ok, `1` validation failure / rejected input, `2` usage or
board-not-found.

## Lineage

- `P5-01` — "Release workflow: validate → tag → dispatch to downstream" —
  migrated complete; completion commit `2ff3a7c5` (`ci: add repository_dispatch
  to release workflow`), subtasks marked done at `04c956ee`. Its `foreman_note`
  carries the original subtask list and the historical blocked-on note
  (`P5-02`–`P5-05`, spec ref `S08`, Cross-Repo Release Pipeline).
- Row ids continue from the historical prefix: new protocol rows should use
  `P<n>-<nn>` for the roadmap phases already named in `../tasks.md`.
