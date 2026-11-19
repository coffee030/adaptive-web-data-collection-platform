# M2 Local Issue Manifest

Baseline `cd7c681`, working branch `feature/M2-persistent-backend-core`. Git had no remote. Issues, Project, PR, and peer review awaited a remote destination.

| Issue / Batch | Objective / Scope | Dependencies | Implementation tasks | Tests / Acceptance criteria | Definition of Done |
| --- | --- | --- | --- | --- | --- |
| M2-01 / A PostgreSQL and SQLAlchemy Foundation | Local DB and schema migrations | M1 baseline | Compose, environment variables, sessions, Alembic | Connect real PostgreSQL, upgrade an empty DB, and verify FK and UNIQUE constraints | Migration, startup and shutdown, and test documentation |
| M2-02 / A Persistent Sources and Profile Versions | Persist Source policy and Profile snapshots | M2-01 | ORM mapping, version uniqueness, UTC, JSONB | Reread nested config and hash after reconnect. Concurrent version creation increments versions. | Retain M1 contracts and regression suite |
| M2-03 / B Transactional Validation and Approval | Atomically store validation and approval | M2-02 | Reports, revision fences, row locks, approval and retirement | Verify stale or failed reports, revocation, rollback, concurrent approval, immutable config | Reread audit, document concurrency policy |
| M2-04 / B FastAPI Source and Profile APIs | Versioned transport | M2-03 | Source and Profile routes, error envelope, health and OpenAPI | Verify success and error states, response schema, persistence | Shared application services and reproducible documentation |
| M2-05 / C Persistent Collection Jobs and State Transitions | Pin approved versions and claim Jobs separately | M2-03 | Job, events, state machine, CLI | Reject unapproved, retired, and mismatched Sources. One concurrent claim succeeds. | Reread Job and events. API creates Jobs only. |
| M2-06 / D Evidence and Generic Record Persistence | Save results, Quarantine, and raw data index | M2-05 | Evidence FK, record identity, Quarantine, atomic publication | Verify hash, missing files or rollback, duplicate work, and Source boundaries | Full lineage and documented orphan handling |
| M2-07 / D Controlled Execution and REST Results APIs | Complete HTML and CSV vertical slices | M2-04 to M2-06 | M1 runner, CLI, paged Records, Evidence metadata | End-to-end real PostgreSQL, HTTP fixture, CSV fixture, and files | Read status and results through REST |
| M2-08 / E Integration Testing, Reliability and M3 Readiness | Verify full workflow and handoff | M2-01 to M2-07 | Regression, restart, migration QA, readiness | Record actual tests, restart, and limitations | List complete and blocked work and M3 recommendations |

Design order was `sources → profile_versions → profile_validation_reports`, then `collection_jobs` and `execution_events`, then `raw_evidence`, `generic_records`, and `quarantined_records`. M2 executes one controlled input per Job and claims the Job as a unit. M0 multi-Task dispatch was later scope. SQL links use UUID, and the M2 application supplies Core Source domain ID as UUID hex. M1 clients can use their existing string IDs.

- Batch A passed 115 tests and Alembic upgrade and check. Compose container verification awaited Docker.
- Batch B passed 122 tests and Alembic upgrade and check, including stale report, rollback, concurrent approval, database immutability trigger, and FastAPI.
- Batch C passed 15 M2 tests and Alembic upgrade and check. Jobs pin version and hash. CLI claim and status events use separate transactions.
- Batch D passed 20 M2 tests and Alembic upgrade and check, covering both adapters, lineage, replay, missing Evidence, and rollback.
- Batch E passed 134 tests, Uvicorn and CLI, and native PostgreSQL restart. The M2-08 Compose named-volume gate awaited Docker.
