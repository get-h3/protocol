# Task Board — H3 Protocol (`github.com/get-h3/protocol`)

## [ ] P5-01 — Release workflow: validate → tag → dispatch to downstream
- [ ] Create `.github/workflows/release.yml` — validate schemas, tag on push to main
- [ ] Create `.github/workflows/dispatch.yml` — on release published, trigger SDK repos via repository_dispatch
- [ ] Add `repository_dispatch` event handlers to trigger on `protocol-release` event type
- [ ] Test: push a patch version → tag created → dispatch fires to sdk-go, sdk-python, sdk-typescript

**Blocked on:** P5-02–P5-05 (SDK sync-protocol workflows must exist to receive dispatch)
**Spec ref:** S08 (Cross-Repo Release Pipeline)
