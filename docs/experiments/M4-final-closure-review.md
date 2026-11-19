# M4 Final Closure Review

**Decision on 2026-11-14. The user accepted the M4 technical fixes and authorised M5.** [Authorisation and acceptance scope](#2026-11-14-user-authorisation-and-acceptance-scope-update)

**Historical Final Gate record — M4 CLOSURE NO-GO / M5 NO-GO**

Local technical verification used `439e1a2` on `fix/M4-closure`, descended from M4-E `081c5f3`. Later closure commits changed only documentation. Acceptance was assigned to the user. Narrator, iPhone Safari, and physical 8 GB Windows still needed recorded acceptance or a decision on applicability. M5 still required explicit user authorisation at this point.

## Audit scope and result

| Milestone | Closure review |
| --- | --- |
| M4-A — Collection Jobs | Compared M4-A acceptance evidence, statuses, and event DTOs. Checked deterministic order, empty tail pages, 404, invalid-time fallback, and polling. |
| M4-B — Sources | Reviewed registration, authorisation, and navigation to Profiles. A PostgreSQL unique key, payload digest, and transaction protect Source replay. Kept existing terminal authorisation. |
| M4-C — Profiles | Draft revisions are compared inside a server transaction. A stale write returns 409 and a missing revision returns 428. Approved versions are immutable and stale reports cannot support approval. Tested two browser tabs and reload recovery. |
| M4-D — Records, Quarantine, Evidence | Checked payloads, physical row positions, count meanings, and lineage. Evidence-only Jobs link directly to metadata. Without a capture the UI shows an empty state. The DTO omits internal storage reference. |
| M4-E — Submission and demo | Live database and Linux Celery prefork ran HTML and CSV, exact Profile pins, replay, recovery, and persistence. Checked layout and axe at four viewport sizes. |

The issue ledger records defects, fixes, and tests. Historical acceptance counts are retained. The runbook provides the demonstration steps. [Issue ledger](M4-outstanding-issues.md) [Demo runbook](../demo/M4-core-demo-runbook.md)

## Verified gates

- Verified and installed the official Windows binaries needed by Playwright. [Environment readiness and browser versions](M4-environment-readiness.md)
- Confirmed P0 and in-scope P1 and P2 issues had fixes and regressions. Source Authorisation and Profile Approval retain a trusted local workflow and require explicit `LOCAL_PROFILE_APPROVAL=1` for the UI. The operator supplies the approval label.
- Full backend, controlled Chromium, live Docker, TypeScript, Vite, Ruff, Alembic, and representative cross-browser workflows passed. [Results and checks not run](M4-remediation-test-results.md)
- PostgreSQL 0006 migration passed. An isolated rehearsal verified database restart and Evidence contents. The resource-limited Compose stack completed real Jobs. Dispatcher and HTML fixture shutdown signals were corrected and verified in isolated containers.
- Git remediation commits covered the milestone scope. The local branch included code, contracts, and the runbook for the user's local review.

## Acceptance gates

| Gate | Status | Required action |
| --- | --- | --- |
| GitHub remote and PR | DEFERRED TO M5 | Delivered through local Git. |
| Teammate review | OUT OF SCOPE | Personal acceptance by the user. [Local acceptance checklist](../reviews/M4-teammate-review-checklist.md) |
| Windows Narrator | NOT RUN | The user records speech, focus, errors, statuses, and confirmation actions. [Narrator procedure](../reviews/M4-narrator-acceptance.md) |
| macOS Safari | OUT OF SCOPE / NOT RUN | The user removed this criterion because no Mac was available. |
| iPhone Safari and physical 8 GB Windows | NOT RUN | The user could test either independently or explicitly accept the untested limitation. [Physical-device and resource evidence](M4-device-and-resource-acceptance.md) |

## MVP boundaries

The scope was controlled HTML and CSV, trusted loopback operation, and an operator-supplied approval label. Full production authentication requires separate scoping. Offset pagination reads live rows, so inserts or state changes can shift or overlap pages. The server rejects Sources outside policy. The Evidence UI displays stored metadata. The isolated backend verified actual capture bytes and checksums. External acceptance follows the states above.

## Final Gate decision

**Formal M4 acceptance awaited a user decision.** Technical evidence was retained, and code and tests still matched `439e1a2`. The original Firefox crash was retained. Six Evidence reruns passed and the cause remained unknown. [Test evidence](M4-remediation-test-results.md#final-gate-follow-up-verification)

The original plan was to record formal M4 acceptance after the user ran Narrator and separately tested or accepted limitations for iPhone Safari and physical 8 GB Windows. **M5 NO-GO** until independently authorised by the user.

## 2026-11-14 User authorisation and acceptance scope update

- The user accepted the M4 technical fixes as the baseline and explicitly authorised M5 Core Stabilization, Technical Evaluation, and Release Candidate development.
- The NO-GO above records the original Final Gate decision. Historical results and execution records remain as recorded.
- Actual iPhone and iOS Safari, macOS Safari, physical 8 GB Windows, personal-device and custom-environment integration, and manual screen-reader acceptance requiring the user were deferred until after M5 as **DEFERRED / NOT RUN**.
- Formal teammate review still required separate scheduling and was removed from the M4 closure gate.
- Authorisation covered the trusted local Core MVP. Production readiness was unclaimed. M6 and M7 still required separate authorisation.
