# M5 Readiness Review

## M5 technical decision

**M5 CORE RC GO** for a trusted-local Core MVP with controlled data.

On 2026-11-14 the user accepted the M4 technical fixes as the baseline and authorised M5. The original Final Gate NO-GO and historical tests are retained. [M4 decision](M4-final-closure-review.md#2026-11-14-user-authorisation-and-acceptance-scope-update)

| Criterion | Verification evidence |
| --- | --- |
| Scope and architecture | Reused modular monolith, PostgreSQL, Redis and Celery, Scrapling, and React. Added as-built Mermaid diagram and original Proposal FR/NFR gap matrix. [Architecture](../architecture/M5-core-architecture-review.md) [Matrix](../architecture/M5-core-capability-matrix.md) |
| Security and reliability | Fixed robots path mismatch, URL logging, and amplified HTML text. Passed Draft concurrency, Source and Job replay, approved immutability, bounded retry, worker termination, Redis, and DB outage tests. [Test Results](M5-test-results.md) |
| Integrity | HTML 2/0/0 and CSV 2/3/1 with Quarantine positions and categories. Verified actual raw bytes, SHA-256, Job, Profile and Source lineage, and restart snapshots. [Evaluation](../evaluation/M5-core-evaluation-results.md) |
| Deployment and demonstration | Fresh isolated Compose, Alembic 0006, Linux prefork worker, Vite build, and browser journey. Safe stop, named volumes, and matching data after restart. [Runbook](../demo/M5-core-demo-runbook.md) |
| Downstream | M6 and M7 can read by Job ID and use approved pins, validated Generic Records, Quarantine, Evidence metadata, and source position. [Contract](../contracts/M5-downstream-integration-contract.md) |
| Final gate | 182 backend, 78 controlled Chromium, 14 live Chromium, and 6 live plus 2 focused polling each for Firefox and WebKit. TypeScript and build, Ruff, Alembic, 56 live axe scans, and Impeccable source and 44 renders passed. [Test Results](M5-test-results.md) |

## Handoff and remaining limits

Formal human code review was pending outside local technical acceptance. The repository had no remote at this point. Connecting private GitHub required the user to confirm the owner or organisation, private repository, account and write access, and connection, publication, and push authorisation. Local Git supported review of the existing feature branch.

The local RC name is `core-mvp-rc1`. The handoff was in the parent folder, following M4 Final Gate. The trailing blank line in the teammate brief was a user workspace edit separate from the RC commit.

Technical scope is trusted-local controlled HTML and CSV, at-least-once queue delivery, and fenced commits. Two-worker throughput was about 1.02× one worker in this bounded workload, below the 1.5× Proposal target. Internet scale was unverified. Public crawling, production authentication, dynamic browser collection, raw Evidence bytes over HTTP, global snapshot pagination, and M6 or M7 domain logic were outside the Core contract at this milestone. Evidence retention, dispatch history growth, and backups were maintenance limitations.

Actual iPhone and iOS Safari, macOS Safari, physical 8 GB Windows, personal device integration, and manual screen reader were **DEFERRED / NOT RUN**. The user chose to handle them separately. [Post-M5 checklist](Post-M5-device-acceptance-checklist.md)

## Historical M4-E decision

**GO for M5 planning and a local Core MVP demonstration.** M4-E browser acceptance covered controlled HTML and CSV, authorisation rejection, uncertain submission replay, and PostgreSQL and FastAPI restart. Teammate review was to take place before merge. M5 implementation had not started at that point. [M4-E acceptance](M4-E-acceptance.md)

## Teammate checklist

Teammate review was **NOT RUN**. Reviewers can repeat the workflow in the same isolated Compose project. [Demo runbook](../demo/M4-core-demo-runbook.md)

- [ ] Verify the Job form uses existing React Router, API client, Source policy, and UI patterns.
- [ ] Check actual 201, 200, 403, 409, and 422 behaviour and the persisted Job and Profile pin.
- [ ] Confirm Source authorisation through the trusted backend and Profile Approval only in the explicitly enabled loopback demo.
- [ ] Reproduce Preview, Validation, stale-report rejection, and immutable Approved Profile.
- [ ] Observe pending and running updates and check terminal status, events, and all three result counts.
- [ ] Reproduce HTML and CSV lineage, including CSV lines 5, 6, and 7 and Evidence Metadata.
- [ ] Check Retry, the same key, and matching data across API stop and recovery.
- [ ] Check the 390px Job form, keyboard focus, horizontal scrolling, and records. Compare test evidence and limitations.

Production needs identity, permissions, deployment, and safety design. M4-E verified a trusted local operator with controlled fixtures and existing M3 architecture. Existing at-least-once execution and backend Evidence checks apply.
