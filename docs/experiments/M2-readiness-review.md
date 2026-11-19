# M2 Readiness Review

Verification ran on 2026-11-14 Hong Kong time. The development branch started from M1 commit `cd7c681`.

| Definition of Done | Status and evidence |
| --- | --- |
| M0 and M1 regression | PASS. Retained the original 112 tests. |
| Local PostgreSQL, empty schema, migrations, FK and UNIQUE | PASS. Used native Windows PostgreSQL 17.7. Each test migrated an empty schema and a separate empty database also upgraded successfully. |
| Source and Profile retained after restart | PASS. Reread and compared after restarting two Uvicorn processes and PostgreSQL normally. |
| Approved Profile immutability, stale Validation, concurrent approval | PASS. Tested application rules, row locks, revision fencing, rollback, and SQL trigger. |
| FastAPI Source and Profile | PASS. Validation, approval, retirement, error envelope, and OpenAPI. |
| Pinned Profile Version, durable Job, and states | PASS. Independent execution, exactly one successful claim, rejection of unapproved or retired Profiles, persisted terminal states and events. |
| Shared M1 ingestion for HTML and CSV | PASS. Two real DB vertical slices, with live loopback HTTP and Scrapling for web. |
| Records, Quarantine, Evidence lineage, and duplicate submissions | PASS. Read back over REST and verified hashes, missing files, result rollback, DB relationships, and cross-Source identity. |
| API stop and restart and native PostgreSQL restart | PASS. Real CLI and different API PIDs. Metadata and original file hashes matched. |
| Compose PostgreSQL named-volume restart | **Pending verification**. Compose and a dedicated restart test were provided. Docker CLI and WSL runtime were unavailable locally. |
| Ruff, migration schema check, M2 scope and risk | PASS. The test report records commands and results. |

## M3 decision

**GO for controlled local M3 design. NO-GO at the time for full M2 acceptance and M3 container integration.** Rerunning the dedicated volume restart in a Docker-enabled Linux or WSL2 environment could close the remaining M2 gate.

A crash or prolonged database outage after Job claim commit can leave a Job `running`. Next, finish the M2 Docker acceptance and use an ADR to define dispatch consistency, recoverable leases and attempts, duplicate delivery, and commit-before-ack tests. The M2 CLI and application services provide reusable execution entry points. Public-site DNS, TLS, egress, production authentication, retention, and backups require separate verification. The local approval operator is audit data.

The local issue manifest tracks M2-01 to M2-08. Git had no remote. GitHub Issues, Project, and PR were pending, and peer review still needed scheduling.
