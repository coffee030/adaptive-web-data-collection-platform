# M5 Core Capability Gap Matrix

This matrix compares local FYP Proposal §5.1, §5.3, §7, and §9 (FR01–FR15 and D1–D9) with later M0–M5 scope. An FR with any unfinished part is LIMITED. [M5 test scope and results](../experiments/M5-test-results.md)

| Proposal | Capability | Classification | Evidence and gaps |
| --- | --- | --- | --- |
| FR01 | Users and roles | OUT OF MVP SCOPE | Loopback Host and Origin checks and trusted operator label. Production authentication and RBAC require separate design approval. |
| FR02 | Visual source configuration | IMPLEMENTED BUT LIMITED | Console forms, CSS and XPath, field and dataset mapping, Preview, and Validation. DOM click-to-select, selector generation, and configuring pagination were undelivered. |
| FR03 | Reusable source profiles | IMPLEMENTED AND VERIFIED | Draft revision, immutable Approved Version, retirement, and Source authorisation and revocation. Configuration lets an adapter handle different fields. |
| FR04 | Job management | IMPLEMENTED BUT LIMITED | Manual submission, idempotency, history, monitoring, and automatic recovery. Scheduling, pause and resume, and cancellation are Proposal gaps. |
| FR05 | Discovery and pagination | PLANNED / NOT IMPLEMENTED | One input per Job. No extracted-link traversal, multi-page collection, or URL task frontier. |
| FR06 | Static and dynamic fetch | IMPLEMENTED BUT LIMITED | Scrapling static HTTP replaces the Proposal's HTTPX and Beautiful Soup. Playwright verifies the console. Dynamic collection and arbitrary public crawling were outside the MVP. |
| FR07 | Polite request control | IMPLEMENTED BUT LIMITED | Robots, fixed User-Agent, timeout, bounded redirects and attempts, and 429 and 5xx retries. Robots timing rules that could not be followed caused rejection. Shared domain limits, cache, jitter, and full public policy remained gaps. |
| FR08 | Proxy pool and failover | OUT OF MVP SCOPE | No proxy registry or routing. M5 disallows proxy rotation and blocking evasion. |
| FR09 | Extraction and normalisation | IMPLEMENTED AND VERIFIED | HTML DOM and CSV mapping, string, integer, number, boolean, and required and optional fields. Checked controlled sample output. |
| FR10 | Validation and deduplication | IMPLEMENTED BUT LIMITED | Field types and requirements, first valid per Job, and Quarantine. No generic ranges or global URL or page deduplication. |
| FR11 | Distributed execution | IMPLEMENTED AND VERIFIED | Redis and Celery, one and two replicas, and duplicate claims at controlled MVP scale. Four replicas and internet scale remained unverified. |
| FR12 | Monitoring | IMPLEMENTED BUT LIMITED | Job states, ordered events, counts, errors, and visible detail refresh scheduled about 3 s after each read. No fleet heartbeat, queue Dashboard, alerts, or aggregate latency. |
| FR13 | Failure recovery | IMPLEMENTED AND VERIFIED | Redis outage, worker termination and lease recovery, stale attempt fencing, DB interruption, and bounded retries. Tests support at-least-once delivery and commit protection. |
| FR14 | Output delivery | IMPLEMENTED BUT LIMITED | Documented JSON REST, Record filtering, and detail. No CSV file export, full-text search, or raw bytes over HTTP. |
| FR15 | Audit trail | IMPLEMENTED BUT LIMITED | Source, Profile, Job, Run, position, Evidence SHA-256, time, and failure history. Worker identity audit and central security audit remained gaps. |
| §4.5 and §7 | Schema-change detection | IMPLEMENTED BUT LIMITED | No-records, missing fields, wrong type, and Quarantine. No statistical drift alert, automatic selector repair, or AI agent. |
| §5.3 and §7 | Performance | IMPLEMENTED BUT LIMITED | Repeated bounded workload with one and two workers, reporting measurements. No general verification of four workers, 1.5× Proposal target, shared quotas, or overall throughput. |
| §5.3 and §7 | Data quality | IMPLEMENTED BUT LIMITED | Independently expected and actual outputs for a small fixture. Representative product URLs and general precision and recall were unverified. |
| §5.3 and §7 | Usability and portability | IMPLEMENTED BUT LIMITED | Reproducible console, keyboard and axe, Docker and Vite, and resource samples. The 10-minute user study, physical 8 GB machine, manual screen reader, and physical Safari remained untested. |
| D1, D4, and D7 | Core design, Evidence, deployment | IMPLEMENTED AND VERIFIED | ADRs, migrations, architecture review, loopback Compose, separate volumes, and operator runbook. |
| D2, D3, and D5 | Console, worker engine, request control | IMPLEMENTED BUT LIMITED | See FR02–15 gaps. |
| D6 | Controlled environment | IMPLEMENTED BUT LIMITED | Compose static fixture and test-process HTTP 429, 5xx, redirects, delay, and markup-change injection. A fully featured test-site sandbox remained a gap. |
| D8 and D9 | Evaluation and documentation | IMPLEMENTED BUT LIMITED | Automated tests, reproducible Core experiments, and a demo. Human review and user study, broader data, and final school documents still needed scheduling. |
| M6 and M7 | Sentiment and IA consumers | PLANNED / NOT IMPLEMENTED | Core read REST contract available. Domain pipelines, models, and IA requirements belonged to their own milestones. |

At M5, **Adaptive** referred to configurable extraction, schema mapping, Preview and Validation, versions, and failure-class-based retries. **Scalable** referred to worker replicas on a shared queue with DB fencing, measured only in controlled, bounded tests. **Observable** referred to Jobs, events, counts, Quarantine, and Evidence lineage. Fleet metrics, tracing, and alerts remained gaps.
