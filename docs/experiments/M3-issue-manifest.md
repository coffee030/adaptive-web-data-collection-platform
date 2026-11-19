# M3 Issue Manifest

Development branch `feature/M3-celery-reliable-execution` started from `2790cc3`. With no Git remote, the local manifest tracked work. GitHub Issues, Project, and PR were pending, as was peer review.

| Issue | Status | Verification or output |
| --- | --- | --- |
| M3-00 Environment and M2 Docker Verification | BLOCKED | 134 native tests passed. PostgreSQL 17.7 restart and schema 0004 were verified. The M2 Docker named-volume gate awaited Docker Engine. |
| M3-01 Redis and Celery Foundation | PASS | Redis 7.4.8 portable, Celery 5.6.3, Kombu 5.6.2, and redis-py 5.2.1. Live transport ping, registration, and error reporting. |
| M3-02 Worker / JobExecutor Integration | PASS | A real worker process ran the M2 `JobExecutor`. HTML and CSV results were read back. |
| M3-03 Durable Dispatch | PASS | PostgreSQL Job-row dispatch intent, real Redis stop and restart, publish before rollback, and concurrent dispatch. |
| M3-04 Job Lease and Recovery | PASS | 90-second lease, generation fence, recovery after killing a real worker process. The test advanced lease time. |
| M3-05 Idempotency and Result Safety | PASS | Active and terminal duplicates, database transaction rollback, and broker redelivery after commit and before acknowledgement. |
| M3-06 Retry and Failure Classification | PASS | PostgreSQL scheduling and limits, HTTP 429, HTTP 500, timeout, and terminal access blocking. |
| M3-07 Execution Monitoring | PASS | Status filter, dispatch and attempt fields, and durable event kinds, with backward-compatible DTO fields. |
| M3-08 Docker End-to-End Verification | BLOCKED | Compose config passed. Linux build, prefork, container restart, and Docker resource acceptance awaited a working Engine. |
