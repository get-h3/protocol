# Task Board — H3 Protocol (`github.com/get-h3/protocol`)

> **Canonical board:** `.coding-hermes/board/tasks.jsonl` (JSONL; format and tooling in `.coding-hermes/board/README.md`). Since 2026-09-18 this file is kept as the historical task record and is no longer the write target — `P5-01` below was migrated into the JSONL board with its title and completion commit intact.

## [x] P5-01 — Release workflow: validate → tag → dispatch to downstream (commit: 2ff3a7c5)
- [x] Modify `.github/workflows/release.yml` — added dispatch job with repository_dispatch to 4 downstream repos
- [x] Dispatch to sdk-go (protocol-update), sdk-python (protocol-update), sdk-typescript (schema-updated), shim (protocol-updated)
- [x] Uses ${{ secrets.DISPATCH_PAT }} with peter-evans/repository-dispatch@v3
- [x] Test: push a tag → release job runs → dispatch fires to all SDKs

**Blocked on:** P5-02–P5-05 (SDK sync-protocol workflows must exist to receive dispatch)
**Spec ref:** S08 (Cross-Repo Release Pipeline)
