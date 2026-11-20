# M22C operator pilot

**AWAITING HUMAN TRIALS · Insufficient evidence for an efficiency finding.** The reference rehearsal passed on the pinned product. No human trial has started. The next assignment is **M22A-01**. The coordinator opens its card when the operator is ready to start the clock.

## Revision and protocol

- Product revision `5fcff7a2ac4283cfba69ce6f43e6380be6c8094a` for both arms.
- Evaluation branch `feature/M22C-operator-pilot`. Obtain its separate checkpoint SHA with `git rev-parse HEAD` in the evaluation checkout. The operator journal records both SHAs.
- The [M22A protocol](M22A-Source-Onboarding-Feasibility.md#manual-comparator), [frozen trial sheet](m22a-onboarding-trials.csv) and [M22B attribution addendum](M22B-Bounded-Source-Discovery.md#request-attribution-addendum-to-m22a) govern the pilot. The M22B review recorded 250 passing backend tests. M22C verified the local study environment and reference workflow.

## Technical readiness

- The Windows loopback Dashboard runs on port 5224, the API on 58196, and the mirror on 58197. The isolated `m22c-operator-pilot` Compose project uses PostgreSQL 17, Redis 7.4, separate volumes and a private fixture network. PostgreSQL publishes on loopback port 55596. Redis is internal. The pinned backend and frozen fixture are mounted read-only. The Dashboard type check and production build passed.
- Four separately authorized Sources each have their own frozen task prefix and 2,000 ms pacing. API readback confirmed zero saved Profile versions for all four. One automated Dashboard rehearsal used an independent reference Source. It reached approval and read back the same version, revision 1, configuration hash and passing report ID.
- The two fixture channels attributed 3 browser mirror GETs, 4 discovery GETs, 3 explicit Preview GETs, 3 explicit Validate GETs and 7 separately identified Compose probes. Core's three genuine robots GETs stayed in their action windows. A rejected discovery entry logged one pre-send denial and zero fixture receipts. Approval made zero fixture GETs.
- Reference discovery used four requests and proposed a three-request saved Profile. The rehearsal changed the editor to four before creating the draft. Measured operators make assigned setting changes themselves on the clock. The raw proposal and saved Profile each scored 2/2 links and 4/4 typed values. Replay included the HTTP fixture's HTML wrapper and reproduced the stored validation sample hash.
- The [scoped reference summary](m22c-reference-evidence.json) contains reference-only identifiers and counts. Raw local evidence under `.local/m22c/reference/` includes `session.jsonl`, `artifacts.json`, `internal.jsonl`, `mirror.jsonl` and `approved.png`. The [coordinator runbook](M22C-Coordinator-Runbook.md) gives reproduction and resume commands.

## Human trial results

| Assignment | Layout pair | Arm | Status | Elapsed | Link and field quality | Unauthorized requests |
| --- | --- | --- | --- | --- | --- | --- |
| M22A-01 | Cards | Manual | Planned | Unmeasured | Unmeasured | Unmeasured |
| M22A-02 | Catalog | Manual | Planned | Unmeasured | Unmeasured | Unmeasured |
| M22A-03 | Cards | Assisted | Planned | Unmeasured | Unmeasured | Unmeasured |
| M22A-04 | Catalog | Assisted | Planned | Unmeasured | Unmeasured | Unmeasured |

Each arm has two assigned, zero completed and zero failed. No trial opened, so fallback, waiting time, quality and policy compliance are unmeasured for both arms. The [results CSV](m22c-onboarding-results.csv) preserves all four planned rows and blank measurement cells.

Pair manual M22A-01 with assisted M22A-03 and manual M22A-02 with assisted M22A-04. For each completed pair report `100 × (manual elapsed − assisted elapsed) / manual elapsed`. The two percentages and their median are unmeasured. With two complete pairs, the median is the mean of the two percentages. A positive pilot finding requires both pairs to complete, median saving of at least 20%, assisted link and field scores at least as high as manual in each pair, and evidence of zero unauthorized requests in both arms. Record known failures separately if a necessary comparison or policy count is unavailable.

The operator's Dashboard and layout familiarity may influence both arms. Manual-first ordering can give the assisted arm a learning advantage. These two pairs use controlled layouts, so any finding applies only to this pilot. Independent review is pending.
