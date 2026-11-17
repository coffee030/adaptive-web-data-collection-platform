# M10 Scalability Evaluation

## Environment and configuration

The evaluation ran on a Windows 11 AMD64 build 26200 host with 31.9 GiB installed, Docker Desktop 4.99.0, Linux Engine 29.9.3 under WSL2 and Compose 5.7.0. The Engine reported 16 logical CPUs and 16.71 GB (15.56 GiB) available memory. The backend used Python 3.12.14, Celery 5.6.3, PostgreSQL 17.12 Alpine, Redis 7.4.8 Alpine and the locked dependencies at the reviewed M9 baseline. Comparison runs used one isolated project, unchanged images, the default service resource settings and no custom CPU or memory quotas. Redis retains its 64 MiB configured data limit and no-eviction policy.

Each Celery replica used one verified prefork slot and one prefetch slot. The runner confirmed real responses from the expected number of workers and sampled the entire project with Docker stats. Unrelated existing containers were left in their original state. During measured trials, M10 browser and reliability tests were idle.

## Workloads

| Label | Per measured trial | Expected output |
| --- | --- | --- |
| Short | 48 Jobs alternating the committed two-row HTML table and the committed CSV fixture | 48 captures, including 24 HTTP pages. 96 accepted Records. The 24 CSV Jobs each preserve 3 quarantined rows and count 1 duplicate. |
| CSV | 36 Jobs with the same generated 1,200-row CSV per Job | 36 dataset captures, 43,200 accepted Records and no duplicates. Exercises parsing, type validation, persisted data and Evidence I/O. |
| Shared origin | 4 keyword Jobs on the same approved Cards fixture with keyword `quick` | 8 HTTP page captures and 4 Records. Each Job sends robots, search and detail requests through the active one-second origin limit. |

The application receives each Job through its normal HTTP API. Each repetition creates fresh approved Sources, Profiles and Job keys and runs one CSV warm-up per replica. Per-job deduplication is isolated and benchmark Profiles do not enable Article history. Each run retains its own records in a dedicated test volume. The fixed topology order is **1, 2, 4, 4, 1, 2, 2, 4, 1**, which places each worker count once in each three-repetition block.

The end-to-end clock starts just before the first POST and stops when a batched PostgreSQL query observes that all Jobs are terminal. Polling is at 100 ms between read attempts and timing excludes staging and post-run validations. SQL checks persisted capture and Record totals and the expected Job outcomes. A separate execution-span rate uses the earliest worker claim and the latest stored `finished_at` timestamp. That timestamp is assigned inside the terminal transaction before commit. The span can include idle gaps between dispatch rounds. Individual Job latencies use the database creation and finish timestamps. Worker concurrency comes from overlapping database claim-to-finish intervals and the independently verified Celery slots. Captures include dataset Evidence for CSV. HTTP page counts exclude the robots response.

Docker CPU percent is measured in one-core units. Sampled working set is the Docker CLI's memory usage. PostgreSQL cumulative database counters are sampled across each batch. Very short queries, sample timing, shared VM activity and a warmed filesystem can influence the readings. The results describe the tested host and fixture sizes.

## Reproduction

Install the locked backend dependencies and pytest in an isolated Python 3.12 environment. From the repository root, open a PowerShell session with access to Docker Desktop. Select a new M10 test project and confirm its loopback ports and Docker subnets are unused. The values below match the evaluation defaults for a clean project. The helper generates a private per-project test password under the ignored `.local/` directory. Use distinct values if reproducing alongside an existing project.

```powershell
python -m pip install -r backend/requirements.txt pytest
. ./backend/experiments/m10_environment.ps1
docker compose @composeArgs build api
docker compose @composeArgs up -d --no-build --wait postgres redis collection-fixture
docker compose @composeArgs run --rm --no-deps api python -m alembic upgrade head
docker compose @composeArgs up -d --no-build --wait
Invoke-RestMethod "${env:M3_TEST_COMPOSE_API_URL}/api/v1/health"
python -m backend.experiments.m10_scalability --output .local/collection-m3-test-m10-evaluation/scalability.jsonl
docker compose @composeArgs stop
```

The runner requires a new output file and checks the project name and both loopback bindings before scaling. The stop command retains named volumes. Running fault injection or browser acceptance concurrently would change the load and can interrupt a trial.

The first instrumentation attempt was stopped after the Windows Docker CLI emitted ANSI control sequences alongside JSON and the sampler could not parse some lines. Submitted synthetic Jobs were allowed to finish. The corrected runner decodes JSON separately from terminal controls, checks samples exist for every service, and produced the reported series in a new file.

## Results

All 27 measured batches completed with the expected Job and capture counts. Across batches, 792 Jobs produced 828 captures, including 288 HTTP pages, and 389,700 accepted Records. The short batches recorded 216 expected duplicates and 648 quarantined rows. There were zero Job errors, Job execution retries and dispatch retries. Every trial reached peak concurrent claims equal to its verified Worker count.

### Raw trials

Latency columns show the per-trial Job median and nearest-rank p95. With only four Jobs, the shared-origin p95 is the maximum. All values are calculated from the individual trial log.

| Trial | Workload | Workers | Seconds | Jobs/s | HTTP pages/s | Captures/s | Records/s | Execution-span Jobs/s | Job p50 / p95 (s) | Docker samples |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | short | 1 | 3.050 | 15.738 | 7.869 | 15.738 | 31.48 | 21.049 | 1.704 / 2.673 | 36 |
| 1 | csv | 1 | 9.294 | 3.873 | 0.000 | 3.873 | 4648.03 | 4.349 | 4.921 / 8.462 | 114 |
| 1 | shared_origin | 1 | 11.815 | 0.339 | 0.677 | 0.677 | 0.34 | 0.361 | 7.235 / 11.755 | 144 |
| 2 | short | 2 | 2.947 | 16.287 | 8.144 | 16.287 | 32.57 | 21.444 | 1.591 / 2.557 | 42 |
| 2 | csv | 2 | 5.500 | 6.546 | 0.000 | 6.546 | 7854.69 | 8.013 | 3.111 / 5.067 | 77 |
| 2 | shared_origin | 2 | 11.722 | 0.341 | 0.683 | 0.683 | 0.34 | 0.361 | 8.105 / 11.608 | 168 |
| 3 | short | 4 | 2.901 | 16.548 | 8.274 | 16.548 | 33.10 | 21.282 | 1.504 / 2.454 | 54 |
| 3 | csv | 4 | 3.688 | 9.762 | 0.000 | 9.762 | 11714.18 | 13.924 | 2.239 / 3.225 | 63 |
| 3 | shared_origin | 4 | 11.610 | 0.345 | 0.689 | 0.689 | 0.34 | 0.361 | 8.517 / 11.544 | 207 |
| 4 | short | 4 | 2.976 | 16.129 | 8.064 | 16.129 | 32.26 | 20.815 | 1.609 / 2.599 | 54 |
| 4 | csv | 4 | 3.902 | 9.225 | 0.000 | 9.225 | 11070.00 | 12.989 | 2.356 / 3.375 | 72 |
| 4 | shared_origin | 4 | 11.305 | 0.354 | 0.708 | 0.708 | 0.35 | 0.361 | 6.763 / 11.273 | 207 |
| 5 | short | 1 | 3.174 | 15.122 | 7.561 | 15.122 | 30.24 | 20.434 | 1.775 / 2.776 | 36 |
| 5 | csv | 1 | 9.908 | 3.633 | 0.000 | 3.633 | 4360.09 | 4.080 | 5.056 / 9.013 | 120 |
| 5 | shared_origin | 1 | 11.211 | 0.357 | 0.714 | 0.714 | 0.36 | 0.361 | 6.638 / 11.154 | 138 |
| 6 | short | 2 | 2.844 | 16.877 | 8.439 | 16.877 | 33.75 | 21.153 | 1.579 / 2.545 | 42 |
| 6 | csv | 2 | 5.619 | 6.407 | 0.000 | 6.407 | 7688.86 | 7.950 | 3.200 / 5.167 | 77 |
| 6 | shared_origin | 2 | 11.610 | 0.345 | 0.689 | 0.689 | 0.34 | 0.361 | 8.045 / 11.563 | 168 |
| 7 | short | 2 | 3.016 | 15.913 | 7.956 | 15.913 | 31.83 | 21.527 | 1.578 / 2.483 | 42 |
| 7 | csv | 2 | 5.613 | 6.414 | 0.000 | 6.414 | 7697.00 | 7.964 | 3.147 / 5.098 | 84 |
| 7 | shared_origin | 2 | 11.611 | 0.345 | 0.689 | 0.689 | 0.34 | 0.361 | 7.974 / 11.488 | 161 |
| 8 | short | 4 | 2.727 | 17.600 | 8.800 | 17.600 | 35.20 | 21.442 | 1.350 / 2.334 | 45 |
| 8 | csv | 4 | 3.778 | 9.528 | 0.000 | 9.528 | 11433.38 | 13.588 | 2.105 / 3.307 | 72 |
| 8 | shared_origin | 4 | 11.507 | 0.348 | 0.695 | 0.695 | 0.35 | 0.361 | 9.925 / 11.445 | 207 |
| 9 | short | 1 | 3.052 | 15.728 | 7.864 | 15.728 | 31.46 | 20.908 | 1.731 / 2.701 | 36 |
| 9 | csv | 1 | 9.420 | 3.821 | 0.000 | 3.821 | 4585.78 | 4.288 | 5.017 / 8.605 | 114 |
| 9 | shared_origin | 1 | 11.733 | 0.341 | 0.682 | 0.682 | 0.34 | 0.361 | 7.117 / 11.633 | 138 |

### Three-repetition medians

Speedup divides each median Jobs/s by that workload's one-Worker median. Parallel efficiency divides speedup by the replica count. Absolute execution-span rates use PostgreSQL claim and finish timestamps. They exclude pre-claim waiting before the first claim, can include gaps between Jobs, and do not measure isolated CPU time.

| Workload | Workers | Seconds | End-to-end Jobs/s | Execution-span Jobs/s | Speedup | Efficiency | Captures/s | Records/s | Job p50 / p95 (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| short | 1 | 3.052 | 15.728 | 20.908 | 1.000 | 100.0% | 15.73 | 31.5 | 1.731 / 2.701 |
| short | 2 | 2.947 | 16.287 | 21.444 | 1.036 | 51.8% | 16.29 | 32.6 | 1.579 / 2.545 |
| short | 4 | 2.901 | 16.548 | 21.282 | 1.052 | 26.3% | 16.55 | 33.1 | 1.504 / 2.454 |
| csv | 1 | 9.420 | 3.821 | 4.288 | 1.000 | 100.0% | 3.82 | 4585.8 | 5.017 / 8.605 |
| csv | 2 | 5.613 | 6.414 | 7.964 | 1.678 | 83.9% | 6.41 | 7697.0 | 3.147 / 5.098 |
| csv | 4 | 3.778 | 9.528 | 13.588 | 2.493 | 62.3% | 9.53 | 11433.4 | 2.239 / 3.307 |
| shared_origin | 1 | 11.733 | 0.341 | 0.361 | 1.000 | 100.0% | 0.68 | 0.3 | 7.117 / 11.633 |
| shared_origin | 2 | 11.611 | 0.345 | 0.361 | 1.011 | 50.5% | 0.69 | 0.3 | 8.045 / 11.563 |
| shared_origin | 4 | 11.507 | 0.348 | 0.361 | 1.020 | 25.5% | 0.70 | 0.3 | 8.517 / 11.445 |

### Resources

Cells show maximum observed Docker CPU / working set in MiB across the three trials. Worker values are the maximum for any one replica. These peaks can come from different samples. Docker's CPU interval can overlap a batch boundary, particularly when a shared-origin batch follows a busy CSV batch. A peak provides a resource observation rather than a sustained-load average.

| Workload | Workers | One Worker | PostgreSQL | Redis | Dispatcher | API | Fixture |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| csv | 1 | 73.9% / 160.4 | 73.3% / 281.7 | 3.3% / 10.2 | 4.9% / 75.7 | 22.9% / 85.1 | 29.2% / 30.4 |
| csv | 2 | 75.6% / 159.8 | 63.3% / 273.0 | 2.9% / 6.3 | 6.4% / 76.2 | 16.3% / 84.9 | 22.1% / 30.4 |
| csv | 4 | 73.0% / 159.6 | 120.2% / 304.2 | 3.9% / 6.2 | 7.0% / 75.7 | 15.9% / 84.7 | 26.4% / 17.7 |
| shared_origin | 1 | 72.0% / 161.2 | 37.7% / 268.4 | 3.4% / 7.0 | 1.4% / 75.1 | 1.9% / 84.0 | 21.5% / 30.7 |
| shared_origin | 2 | 70.9% / 159.3 | 56.5% / 242.0 | 3.3% / 6.6 | 1.4% / 76.1 | 1.8% / 84.0 | 22.1% / 28.9 |
| shared_origin | 4 | 71.1% / 159.8 | 115.4% / 253.3 | 2.9% / 9.9 | 1.4% / 75.5 | 1.8% / 83.8 | 26.4% / 30.5 |
| short | 1 | 23.0% / 160.8 | 15.2% / 265.0 | 2.9% / 6.1 | 4.3% / 74.9 | 17.1% / 85.6 | 19.7% / 26.9 |
| short | 2 | 27.7% / 159.6 | 73.1% / 239.3 | 3.3% / 6.2 | 7.2% / 75.2 | 27.9% / 85.5 | 26.6% / 22.4 |
| short | 4 | 37.9% / 159.1 | 49.5% / 247.6 | 3.6% / 6.6 | 8.0% / 75.4 | 23.2% / 85.5 | 28.1% / 26.9 |

PostgreSQL recorded no deadlocks or temporary-file bytes in the measured database-stat deltas. Across the three CSV trials per topology, sampled shared-block hits were about 2.38M, 2.20M and 1.82M. PostgreSQL peaked at 120.2% of one core and 304.2 MiB with four CSV Workers. Redis reported 1,741,344 bytes used after the series, with a 2,544,528-byte high-water mark against its 67,108,864-byte data limit. These measurements do not indicate broker memory exhaustion or whole-VM CPU saturation. Samples do not identify PostgreSQL lock waits, WAL cost or Evidence I/O separately.

### Bottlenecks and interpretation

- **Short** Jobs spent a median 1.33–1.63 s from creation to last dispatch, and around 13–15 ms from claim to the database finish timestamp. A 48-Job burst requires at least three 20-Job polls. The observed 15.73 to 16.55 Jobs/s is consistent with a Dispatcher-limited burst. It has different boundaries and batching from the historical M5 experiment.
- **CSV** median publication-to-claim wait fell from 3.90 s to 1.84 s and 0.71 s. The median claim-to-finish window grew from about 101 ms to 112 ms and 127 ms. The worker path also has commit and acknowledgement work after the in-transaction finish timestamp. Four Workers reached 9.53 Jobs/s and 11,433 Records/s, with all three four-Worker trials above all two-Worker trials. This is a practical improvement on this fixture. The between-Job and dispatch gaps, shared database work and parallel write activity leave room for sublinear scaling. The samples do not isolate each write-side cost.
- **Shared origin** reached essentially the same execution-span rate at all replica counts. Median claim-to-finish time rose from 3.01 to 5.03 and 8.55 s as waiting moved into concurrent origin-controlled executions. The separate real two-Worker regression observed 12 requests with a shortest completed-to-next-start gap of 1.004 s. The existing one-second per-origin policy accounts for the observed throughput plateau.
- After the series, both due-dispatch and lease-recovery probes used the status index on an idle database and completed in 0.112 ms and 0.049 ms. The migrations also define partial due-time and lease-time indexes. The idle plans do not establish a query plan under heavy backlog.
- The observed constraints reflect the frozen scope and safety policies, so M10 added measurements without changing production scheduling or rate limits. Three repetitions describe variability for this host and fixture. There was no physical 8 GB, sustained-load, concurrent-tenant or public-site benchmark.

Raw per-Job timestamps, Docker samples, database counters and identifiers are in ignored `.local/m10/scalability-final.jsonl`. The runner log is `.local/m10/scalability-final.log`, with idle plans and Redis memory readings in `.local/m10/postgres-plans.log` and `.local/m10/redis-memory.log`.
