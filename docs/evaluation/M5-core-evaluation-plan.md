# M5 Core Evaluation Plan

Evaluate the trusted local Core in an isolated Docker Compose project with Linux prefork, synthetic data, and the local API. The results report lists the host, Docker VM, package versions, actual sample sizes, and raw measurement paths. Each run uses a fresh Source and request keys. The one- and two-worker setups use the same image, fixtures, resource limits, and client concurrency of four Jobs.

| Experiment | Hypothesis and procedure | Planned sample and metrics | Limits |
| --- | --- | --- | --- |
| A/B Correctness, validation, and deduplication | Read `table.html` and `listings.csv` manually and fix expected payloads, positions, error classes, and counts before running. Use REST for Source authorisation, Draft, Preview, Validate, Approve, and Job. Compare Records, Quarantine, Evidence metadata, and bytes on disk. | One HTML and one CSV Job per run. Compare complete fields, positions, nulls, types, missing values, errors, duplicates, SHA-256, lineage, and event order. | Both fixtures are test workloads and support no external precision or recall inference. Preview returns at most five entries. |
| C Reliability | Existing live pytest coverage reproduces Redis stop and start, a worker SIGKILL, real 90 s lease expiry, duplicate messages, replica contention, and API and DB restart. Browser acceptance replays the same Job key across a DB outage. | Run each failure case at least once in the final suite. Measure from verifiable same-clock events or new monotonic elapsed times. Verify result rows, a single terminal event, bytes, and before and after snapshots. | Fixed local topology. Covers individual failures. Combined failures, power loss, and durable disk corruption remain outside the test. |
| D/E Timing and concurrency | First measure API cold-ready time and the first HTML Job. For warm runs, send four concurrent client requests across three batches, each with two HTML and two CSV Jobs. Replay each Job with the same key and inspect outputs and events. Compare one and two prefork replicas in sequence. | 12 warm Jobs per topology. Report min, median, max, Jobs/s, accepted Records/s, CPU %, and sampled MiB. Use `perf_counter` for POST and GET. Measure full Job latency on one clock through terminal polling, including polling delay. | Database created to last dispatched measures durable admission to the last confirmed publication. Started to finished includes capture and result preparation, and the finished timestamp precedes commit. Neither interval isolates parsing or queue transport. The small sample cannot support an SLO. |
| D Record processing | Run candidate extraction and shared `ingest` alone on the same bytes and Profile with a warm monotonic clock. Generate 500 CSV rows to show a larger batch and verify its count. | One warm-up and 10 timed iterations per type. Record fixture size and candidate count. | The in-process CPU path includes decoding, parsing, normalisation, and deduplication. HTTP, SQL, and Evidence I/O are excluded. Worker wall-clock timing answers a different question. |
| F Maintainability | Manually check routes and OpenAPI, layers, lockfiles, migrations, failure contracts, log redaction, Compose boundaries, tests, and the runbook. | One review and a full release-candidate rerun. | Evidence comes from code and runs. Formal teammate review and manual usability acceptance require separate sessions. |

Set `M3_TEST_COMPOSE_API_URL` and `M3_TEST_COMPOSE_PROJECT` and run the commands below. Use a separate run per worker topology and confirm all workers are ready first. Run live regression separately from the topology comparison. [M5 Demo Runbook](../demo/M5-core-demo-runbook.md)

```powershell
.\.venv\Scripts\python.exe -m backend.experiments.m5_evaluation --workers 1
docker compose @composeArgs up -d --wait --scale worker=2 worker
.\.venv\Scripts\python.exe -m backend.experiments.m5_evaluation --workers 2
docker compose @composeArgs up -d --wait --scale worker=1 worker
```
