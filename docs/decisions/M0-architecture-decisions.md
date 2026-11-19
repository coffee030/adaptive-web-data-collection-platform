# M0 Architecture Decisions

2026-11-14 Hong Kong time. Decisions reflect the confirmed MVP direction at this milestone. Peer review was pending. Changes to the formal Proposal require the school and team processes.

## ADR M0-01 Modular monolith and single scheduling authority

- **Context.** One person initially develops the Core, with independently scalable workers and reproducible tests.
- **Decision.** Keep a modular monolith and separate Celery workers. FastAPI and Celery share domain and application services, each with its own DB session and transaction. Celery and Redis dispatch, PostgreSQL stores durable state, and Scrapling handles HTTP and HTML.
- **Alternatives.** Synchronous FastAPI, independent microservices, or an additional Scrapling Spider scheduler.
- **Rationale.** One Python project reduces deployment and contract-sharing costs. One dispatch mechanism gives clear ownership of attempts, quotas, and state.
- **Trade-off.** Handle failures between database commit and queue publication. Separate workers still need serialisation and duplicate dispatch tests.
- **Consequences.** M2 and M3 must verify durable dispatch, idempotent writes, commit before acknowledgement, and terminal state protection. Simple database-backed dispatch recovery was an initial candidate.
- **Status.** MVP architecture confirmed. Dispatch consistency still needed verification.

## ADR M0-02 Scrapling HTTP and platform Source Access Policy

- **Context.** The formal Proposal listed HTTPX and Beautiful Soup with limited Playwright. The spike showed Scrapling could handle both static HTML fixtures, HTTP statuses, and metadata, and observed default browser-like headers, redirects, and retries.
- **Decision.** Use Scrapling HTTP and Parser for the MVP. The platform wrapper handles Source authorisation, initial and hop URLs, robots, request budgets, a fixed project User-Agent, timeouts, error classification, and retries. Disable automatic redirects and browser impersonation for real traffic.
- **Alternatives.** Retain HTTPX and Beautiful Soup, or rely on Scrapling defaults for security and retries.
- **Rationale.** Fixture results supported the confirmed choice. The defaults add Chrome headers and Google Referer and retry timeouts, so explicit control was needed.
- **Trade-off.** HTTP imports in 0.5.1 require Patchright. Production DNS pinning, TLS, environment proxies, and response size enforcement still posed technical risks.
- **Consequences.** Start M1 with controlled sites. Enable public Sources only after confirming egress preserves approved IP, Host and SNI, and TLS, with access policy tests.
- **Status.** MVP direction confirmed. Changes from the formal Proposal awaited supervisor confirmation.

## ADR M0-03 Approved versions and traceable ingestion

- **Context.** The general Core collects Web and CSV and needs reproducible, auditable lineage.
- **Decision.** Separate Source access authorisation from extraction Profile approval. A Job pins an immutable, validated, operator-approved Profile Version. Web and CSV produce common candidates, then share validation, deduplication, and Evidence persistence before returning versioned Generic Records.
- **Alternatives.** Let each Job read mutable current settings, or maintain separate CSV and Web persistence.
- **Rationale.** Versions, hashes, and raw bytes support reproduction and audit. Downstream ML and IA can use the same Core interface with their own payload schemas.
- **Trade-off.** Add approval state, validation reports, and Evidence capacity management. Revocation and cross-source deduplication need explicit rules.
- **Consequences.** M1 should test Draft invalidation, approved immutability, Job rejection for unapproved versions, CSV and Web lineage, and invalid candidates. Formal storage, retention, and transactions were deferred to M2.
- **Status.** Conceptual rules confirmed. Schema, retention, and permission design were pending.

## Differences from the formal Proposal and delivery tracking

| Proposal item | Treatment in M0 and early Core |
| --- | --- |
| HTTPX, Beautiful Soup, and Playwright in §4.4, §5.4, and FR06 | M0 verified Scrapling static HTTP and CSS and XPath. Dynamic browser rendering was later delivery scope. The technical difference awaited confirmation. |
| FR01–FR05 | Source and Profile rules begin with conceptual contracts. Roles, visual selectors, scheduling, pause and resume, cancellation, and discovery are phased deliverables. |
| FR07–FR08 | M0 recorded headers, 429, timeout, and redirects. Formal robots, cross-worker rate control, caching, adaptive backoff, and authorised proxy health and failover awaited verification. |
| FR09–FR15 | M0 provided extraction candidates and contracts. Durable workers, validation and deduplication, Dashboard, search and export, REST, heartbeats and lease recovery, and audit were later work. |
| §5.3 NFRs, §7 Evaluation, §8 Schedule, D1–D9 | Retain formal deliveries and criteria, including 1, 2, and 4 worker comparison, 2 workers at ≥1.5× throughput, field precision and recall ≥95%, duplicate product URLs <1%, 10-minute configuration, 3-second Dashboard refresh, recovery, proxy failover, and 8 GB Windows 11 and WSL2 Compose. M0 fixture tests support only local technology selection. |

ML Section B requires a permitted dataset, model training and test results, code, and a report. IA sources, platforms, matching criteria, and acceptance were pending. Both downstream workstreams would connect through Generic Records with schema version and provenance.
