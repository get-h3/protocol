# Diagnostics — how this repo is built and why

Explained trail for future maintainers and debugging agents: how the pieces
fit, what has broken historically, and the right way to work here. Written by
the 2026-09-21 dogfood run; the errors below were hit **in real use**, not
synthesized.

## Architecture: why it looks like this

- **Spec-only repo.** The product is the wire contract. Everything else —
  SDKs, the shim — derives from it via CI (`repository_dispatch` on tags, see
  P5-01 in the board history). Keeping the contract in one git repo makes
  drift between spec/schemas/examples *diffable* and *gatable*.
- **Three layers, one rule: they may not disagree.**
  1. `h3-protocol.yaml` — OpenAPI 3.1 (paths reference schema files with
     relative `$ref`s, response bodies are `$ref`s — promoted from inline in
     P6-02),
  2. `schemas/v1/*.json` — draft 2020-12, `$id`ed, relative refs between
     files (`common.json#/definitions/Message`),
  3. `examples/` — one payload per type, including one per decision branch.
  The drift checker (`tests/check-spec-drift.js`) fails if any layer
  disagrees; the Decision union in the YAML must match `decision.json`
  exactly (discriminator mapping included).
- **The gate is the repo's runtime.** `bash tests/validate-schemas.sh`
  (reached via `make test` since QA-H3-PROTOCOL-1) runs 56 checks: in-process
  ajv validation of all 17 schemas + 16 examples (single Node interpreter,
  P6-03 load fix), one ajv CLI smoke per group (CLI parity), redocly lint,
  gate-coverage check (a schema not validated by the gate fails the gate),
  and the drift checker. All Node deps live in `tests/package.json` —
  deliberately NO root `package.json`.
- **`versions.yaml` is data, not docs.** The installer and release pipeline
  read it as the compatibility authority.

## Errors in this repo's own history (and their fixes)

| Commit/era | What broke | Fix |
|---|---|---|
| pre-2026-09-18 | No machine-discoverable root entrypoint (gate hidden in `tests/`) | Root `Makefile` (QA-H3-PROTOCOL-1) |
| pre-2026-09-20 | Gate spawned an ajv CLI process per assertion → host load spike (52 processes) | `validate-all.js` single-interpreter runner + CLI parity smokes (P6-03) — gate floor now "56 checks" so coverage can't silently shrink |
| 2026-09-20 | README Getting Started assumed make/node/npm without saying so | Prerequisites block (QA-H3-PROTOCOL-2) |
| 2026-09-21 | (this run) README's `npx @redocly/cli preview-docs` broke when the unpinned CLI went 2.x | Filed DF-01; pinned binary still works |

## Errors the dogfood consumer hit (2026-09-21), with lessons

1. **`preview-docs` unknown argument** — unpinned npx = CLI 2.53.3 where the
   command surface became `openapi <command>`. Lesson: any doc that invokes a
   tool without the version pin rots when upstream breaks its command surface;
   pin the major (DF-01).
2. **Curling a "docs page" that 404'd** — two ports (8080, 8123) were
   occupied by unrelated fleet services on the shared host; the 404 came from
   those, not redocly. Lesson: read the tool's own log line
   (`Preview server running at http://127.0.0.1:<port>`) before probing, and
   pick a verified-free port.
3. **Python `referencing` rejects raw dicts** — registries need
   `Resource.from_contents()`. Lesson: the schemas are draft 2020-12; any
   2019-09-era validator workflow (or `jsonschema<4.18`) will fight them.
4. **Cancel response "missing cancelled"** — the *consumer's* bug: built the
   payload from memory of the README table instead of `cancel-response.json`.
   Lesson (a compliment to the repo): the schemas were self-consistent and
   the example matched the schema; the drift gate does its job.

## The right way to do things here

1. Change the contract in all three layers in one commit, then run
   `make test` — the gate's drift + coverage checks are the arbiter, not
   review eyeballs.
2. New schema → add its example in the same change (drift check enforces) and
   confirm the gate floor count rises (coverage check enforces).
3. Never edit `examples/` to make a failing test pass — examples are wire
   fixtures and the round-trip test exists to keep them honest.
4. Render docs from a pinned CLI on a free port; trust the log line, then
   curl `/openapi.json` to confirm the bundle resolved.
5. Tag → release workflow fires and dispatches to the three SDK repos; bump
   `versions.yaml` in the same release change if compatibility moves.

## Verification trail (evidence, not vibes)

- Local: gate 56/56 in 1.35 s (hyperfine warm mean 1.336 s ± 0.019 s, n=20);
  round-trip 10/10 in 0.074 s.
- Fresh machine (bunker-las-03 agent 6a055eee, destroyed after): clone →
  `npm install` 11 s → gate 56/56 in 2 s (Node 22.23.2, npm 10.9.8).
- Consumer: 10 wire exchanges (happy loop, cancel, session get/delete, two
  error paths, one negative validation) all valid against the repo schemas,
  total 0.03 s. Consumer source preserved at
  `docs/dogfood/2026-09-21-integration.md` (recipe inline; scratch copy lived
  in /tmp by design — this repo must not grow a runtime).
