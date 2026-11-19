# M2 Database Decisions

2026-11-14 Hong Kong time. Implemented according to the M2 brief, with peer review pending.

## ADR M2-01 PostgreSQL and Core boundaries

**Context.** M1 managed Source and Profile in memory. M2 needs durable state and consistent approval.
**Decision.** Use PostgreSQL 17, SQLAlchemy 2, psycopg, and Alembic. Application services manage transactions with row locks and invoke lifecycle rules through M1 snapshots. ORM and migrations use separate models.
**Alternatives.** Place ORM models in the Core or use SQLite.
**Consequences.** Existing M1 library calls can be retained. Test PostgreSQL JSONB, locks, and foreign keys. Native Windows supports local verification. Linux PostgreSQL in Compose is the standard development setup. Future Linux API and CLI containers must share the Evidence volume and be reverified.

## ADR M2-02 Pinned Job input and replay

**Context.** The M0 Task contract must support queue redelivery. M2 executes one controlled input.
**Decision.** Use the Job row for a durable claim, pin Profile Version and hash, and accept a client request key per Source. M1 keeps the first valid result within each Job. The database can retain snapshots from different Jobs.
**Alternatives.** Use separate Job, Task, and attempt layers or global deduplication.
**Consequences.** CLI can replace a transport trigger. A Job enters running once. Hard termination can leave it running. Design lease, recovery, retry, and reliable dispatch in M3.

## ADR M2-03 Evidence and results publication

**Context.** Preserve raw bytes in verifiable local files and track results and lineage in the database.
**Decision.** Reuse M1 staged Evidence and verify bytes and hash again. Publish metadata, results, and terminal state in one database transaction. A composite FK prevents cross-Job Evidence references.
**Alternatives.** Store raw bytes alongside metadata in PostgreSQL or use a compensating transaction to remove files.
**Consequences.** DB failure may leave orphans. Operators compare data during downtime so cleanup cannot race publication. Long-term retention and consistent database and filesystem backup remained for later verification.
