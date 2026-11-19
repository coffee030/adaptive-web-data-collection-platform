# M0 Readiness Review

**M1 was GO for controlled environments. Public Sources and formal M0 closure had outstanding work.** Scrapling passed controlled HTML and loopback HTTP checks. M1 could implement generic extraction, Profile validation and approval, and shared ingestion for CSV on controlled Sources. Public Sources required separate access permission, DNS and egress, robots, and request-safety verification.

## Definition of Done

| # | Acceptance item | Outcome and evidence |
| --- | --- | --- |
| 1 | Repository and prototype baseline | **Partial.** Inventoried the workspace and historical prototype documents. Verifiable source was absent in scope. |
| 2 | Run available existing tests | **BLOCKED.** The designated workspace contained no prototype tests. |
| 3 | Record missing prototype evidence | **PASS**. [Baseline](M0-baseline-report.md) |
| 4 | Document environment and dependencies | **PASS**. The report lists Windows, locks, imports, measurements, and Docker gaps. [Environment report](M0-environment-report.md) |
| 5–8 | Parser, two layouts, HTTP failures, redirects, headers, and retries | **PASS**. All 36 spike tests passed. [Results](M0-scrapling-spike.md) |
| 9 | Conceptual Core contracts | **PASS**. [Core contracts](../contracts/M0-core-contracts.md) |
| 10–11 | ADRs, open decisions, and Proposal differences | **PASS**. Differences were recorded. Supervisor and peer confirmation remained pending. [ADR](../decisions/M0-architecture-decisions.md) |
| 12 | GitHub Issues and Project status | **BLOCKED**. The user confirmed the FYP remote and Project had not been created. |
| 13 | Feature branch commit | **PASS**. Results were committed on local `feature/M0-core-foundation` and could be examined with `git show --stat HEAD`. |
| 14 | Reviewable PR or local change summary | **PASS**. This report, README, and the local branch support review. GitHub Draft PR and second-student review were pending. [README](../../README.md) |
| 15 | Evidence-based M1 decision | **PASS**. Controlled Sources could proceed. Public Source technology and authorisation acceptance remained pending. |

## Pending GitHub work

| Issue | Local status | Acceptance evidence or blocker |
| --- | --- | --- |
| M0-01 Repository Baseline and Prototype Verification | Blocked | Baseline documented. The prototype source, dependencies, and tests were absent from scope. |
| M0-02 Development Environment and Dependency Verification | In Review | Windows setup, imports, and QA passed. Docker and 8 GB had no live test. |
| M0-03 Scrapling Parser Technical Spike | In Review | Two layouts, CSS and XPath, fields, and exceptions passed. |
| M0-04 Scrapling HTTP Fetcher and Safety Spike | In Review | Loopback passed. Production DNS and egress awaited separate acceptance. |
| M0-05 Core Contracts and Architecture Decisions | In Review | Conceptual contracts and outstanding decisions documented. |
| M0-06 Architecture Freeze and M1 Readiness Review | In Review | ADRs, Proposal differences, and readiness documented. Peer review and formal submission were pending. |

Once the destination exists, verify repository, default branch, PR and branch protection, Project fields, and existing issues, milestones, and labels. Use existing settings and add the missing M0 milestone and six issues. Record Objective, Scope, Tasks, Acceptance, Testing, Dependencies, Deliverables, Risks, and DoD. Assign verified users and link the Project. After confirming the remote base, push the feature branch, open a Draft PR, update statuses from actual evidence, and arrange a second-student review.

## Next Codex task

Build the M1 vertical slice on controlled HTML and CSV fixtures. Cover Draft Profile versions, Preview, Validation, human approval, and approved-config reuse, returning traceable Generic Record candidates. Test unapproved or modified versions, missing or invalid fields, duplicate input, and Evidence lineage. Independently verify an HTTP wrapper can constrain the actual connection destination before considering public Sources.
