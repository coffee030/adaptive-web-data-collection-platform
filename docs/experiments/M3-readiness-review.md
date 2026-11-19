# M3 Readiness Review

Native Windows regression and Linux Docker Gates A–E passed. [Integration evidence and resource samples](M3-test-results.md)

| Definition of Done | Status | Evidence |
| --- | --- | --- |
| M0, M1, and M2 regression | PASS | 134 tests before edits, with full regression retained |
| Docker environment checked | PASS | Windows 11 Pro 25H2 build 26200, working WSL2, and Docker Engine 29.9.3 reporting linux |
| M2 PostgreSQL named-volume persistence | PASS | PostgreSQL 17.12 container retained its named volume, data, and Evidence after normal restart |
| Redis starts and responds | PASS | Portable Redis 7.4.8 returned PONG and Celery and Kombu connected |
| Worker receives real broker tasks | PASS | Linux Celery 5.6.3 prefork worker and real Redis 7.4.8 queue |
| Worker delegates to M2 executor | PASS | Approved Source and Profile through `JobExecutor` and M1 pipeline |
| FastAPI creates asynchronously executed Job | PASS | Live API, Dispatcher, broker, and worker ran controlled HTML and CSV |
| Job durable before dispatch | PASS | Job, input, event, and dispatch intent share a PostgreSQL transaction |
| Redis publication failure leaves durable Job | PASS | Redis stopped and restarted on the same test port. Failed dispatch was recorded before successful dispatch. |
| Duplicate publication safe | PASS | Redispatch after SQL rollback and concurrent Dispatchers |
| Duplicate delivery preserves committed results | PASS | Active and terminal duplicates and unacknowledged recovery with one result and terminal event |
| Worker failure recovery | PASS | Linux worker container received SIGKILL. Attempt 2 succeeded after real 90-second lease expiry. |
| Stale Worker cannot overwrite results | PASS | Real PostgreSQL fencing verified expired lease, reclaim, and stale success and failure |
| Bounded retry | PASS | At most 3 attempts, backoff, and terminal state on budget exhaustion. Redis outage does not use execution budget. |
| Access blocking stops requests | PASS | Controlled 403 and challenge, keeping robots and origin limits |
| PostgreSQL authoritative state | PASS | Worker, Dispatcher, and API share a database. Celery backend disabled. |
| Evidence and record traceability | PASS | One metadata entry with Job, Profile, and Run lineage, original bytes, and SHA-256 |
| HTML and CSV integrations | PASS | Linux Compose HTML yielded 2 valid Records. CSV partial yielded 2 valid, 1 Quarantine, and 1 duplicate. |
| Broker and worker failures | PASS | Linux Compose Redis stop and redispatch, SIGKILL recovery, and duplicate-message skip |
| Container restart preserves records and evidence | PASS | PostgreSQL snapshot, shared Evidence bytes, and SHA-256 matched after restart |
| Real Redis and Celery integration | PASS | Linux prefork worker registered and ran collection.execute_job |
| Resource usage measured | PASS | One sample across six Linux containers totalled about 313 MiB. Whole-machine usability at 8 GB remained untested. |
| Ruff and migrations | PASS | Ruff lint and format and Alembic 0005 and check, including pending, running, and terminal row upgrades |
| Documentation reflects results | PASS | Architecture, Contract, ADR, Test Results, Manifest, README |
| M3 scope preserved | PASS | No React, ML, or IA features added |

### Historical environment blocker

Two Compose cases were previously skipped because firmware virtualisation was disabled. Virtualisation was later confirmed and Docker Desktop started its Linux Engine. Earlier results remain in the report. [M3 Test Results](M3-test-results.md)

### Closure decision

**M3 GO / M4 GO.** Gates A–E passed. The final full regression had 172 passed, 0 failed, and 0 skipped. M4 could start with React and TypeScript Collection Jobs list and detail, using Jobs, Events, and Records APIs and retaining the Impeccable Skill, PRODUCT.md, and DESIGN.md. Whole-system use on an approximately 8 GB host still needed measurement.
