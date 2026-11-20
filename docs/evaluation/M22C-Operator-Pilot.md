# M22C operator pilot

**AWAITING HUMAN TRIALS · Efficiency unmeasured.** The corrected evaluator passed the technical checks on independent reference Sources. No human trial has started. The next assignment is **M22A-01**. The coordinator opens its card when the operator is ready to start the clock.

## Revision and protocol

- Product revision `5fcff7a2ac4283cfba69ce6f43e6380be6c8094a` for both arms.
- Evaluation branch `feature/M22C-operator-pilot`. The correction started from reviewed evaluation revision `64670ded3df358cf331ce94b0a7b6e6d4fe14786`. The isolated study-machine runs record evaluator code revision `6a490712e065d95187c0c120f141c0782c27ce8d`. Obtain the current evaluation handoff SHA with `git rev-parse HEAD`. The journal records product and evaluation SHAs separately.
- The [M22A protocol](M22A-Source-Onboarding-Feasibility.md#manual-comparator), [frozen trial sheet](m22a-onboarding-trials.csv) and [M22B attribution addendum](M22B-Bounded-Source-Discovery.md#request-attribution-addendum-to-m22a) govern the pilot. The M22B review recorded 250 passing backend tests. M22C verified the local study environment and reference workflow.

## Evaluator correction

The frozen selector score supplies the assigned listing and details, then checks two links and four typed values. The configured-search diagnostic answers whether the saved configuration or raw proposal can reach the assigned results using the actual Source, search path, parameter and keyword. It uses the Core keyword entry point shared by Preview and Validate. The offline result is separate from the frozen decision thresholds and the live receipt count.

The synthetic score regression used identical selectors and the reference keyword `C++ & tea`. Both the final saved configuration and the raw proposal took each reporting path.

| Configured target | Fixture response | Assigned results, final and proposal | Frozen scores, final and proposal |
| --- | --- | --- | --- |
| `search?q=C%2B%2B+%26+tea` | 200, assigned listing | 2 of 2 | 2/2 links, 4/4 typed values |
| `search?keyword=C%2B%2B+%26+tea` | 200, no assigned results | 0 of 2 | 2/2 links, 4/4 typed values |
| `missing-search?q=C%2B%2B+%26+tea` | 404, allowed path | Unmeasured | 2/2 links, 4/4 typed values |

The stop signal, reason, monotonic elapsed time and cutoff are durable before terminal capture or readback. Completion requires the successful approval response by the cutoff and matching Source, version, revision, configuration hash and passing validation report in the persisted approval evidence. API response observation time is captured before body parsing. An interrupted attempt can be audited with its original clock. Confirmed premature stops, timeouts and abandonment are `failed`. Missing, conflicting or interrupted evidence that prevents verification is `incomplete`. Legacy Enter-only success cannot satisfy the next-assignment check as `completed`.

### Correction verification on the study machine

The isolated Windows Edge Dashboard used the pinned product with a separate API, database, Redis and two fixture channels. Each run used its own reference Source. Automation exercised the Dashboard and runner capture without a measured task or participant.

| Sanitized local evidence reference | Approval response relative to cutoff | Snapshot readback relative to cutoff | Preserved technical elapsed | Adjudication |
| --- | ---: | ---: | ---: | --- |
| `reference-review-verified` | 17.1 ms before | 98.1 ms after | 19.2221502 s | `completed` |
| `reference-review-early` | 50.0 ms after | 161.0 ms after | 19.229238 s | `failed`, premature stop |

Both runs reconciled 3 browser mirror GETs, 4 discovery GETs, 3 Preview GETs and 3 Validate GETs per run. Each had 6 separately attributed Compose probes, 1 pre-send denial with zero receipts and zero fixture GETs for approval. Each raw proposal and saved Profile reached the reference listing and recovered 2/2 links and 4/4 typed values. The archive and scorer commands are in the [coordinator runbook](M22C-Coordinator-Runbook.md#reference-reproduction). The fresh evidence directories and earlier pilot rehearsal are retained locally.

- **53 Python tests passed, 0 skipped** in the offline cached image. This includes 8 focused M22C cases and the 45 existing M22A/M22B reference tests. Ruff lint and formatting passed. Lint excluded `EXE002` for the Windows bind mount.
- **14 Node tests passed, 0 skipped.** Synthetic events covered timely approval with body parsing after the cutoff, early Enter and later approval, conflicting Source/version/revision/hash/report, unavailable evidence, cutoff ties, the 900-second cap, abandonment and crash recovery. A later snapshot preserved the original elapsed time. The resume gate rejected an unverified or legacy `completed` result.

**Technical finding.** Configured search, stop adjudication and receipt attribution passed on the independent reference setup. The coordinator still needs the normal preflight on the retained pilot services and assigned Source state before opening the first card. Human timing, quality and request compliance remain unmeasured.

## Original pilot setup and retained rehearsal

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
