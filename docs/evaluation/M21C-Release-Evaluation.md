# M21C — Release evaluation

**Release verdict.** The reviewed candidate supports a local Windows 11 demonstration of the Adaptive Scalable and Observable Web Data Collection Platform. The default Compose project passed all 27 synthetic scalability batches. The two-Worker CSV median remained lower in a matched follow-up. Controlled Worker, broker and database recovery passed. The separately constrained one-Worker Synthetic Demo passed Dashboard collection, Evidence and exports across Stop/Start. The three real HTTPS publishers and two-origin Dashboard/MCP collection are supported by reviewed M21B evidence. Physical 8 GB acceptance is **Not run – physical host unavailable**. Hosted PR CI is **Not run**. Independent review and merge remain pending.

## Revision and environment

Evaluated on 20 November 2026 (Hong Kong time). Application SHA [f0ba4a32368b36f5038a0d35f8ccb9d382aa2707](https://github.com/coffee030/adaptive-web-data-collection-platform/commit/f0ba4a32368b36f5038a0d35f8ccb9d382aa2707) matched the fetched M21B tip. M18B `5f6f5b4`, M19 `65b8e73`, M20 `3591d6c` and M21A `fbb5393` are ancestors. M21B adds only its acceptance report to `fbb5393`, the application revision used for the live publisher evidence. The M21C report commit is downstream of the tested SHA. [M21 exit criteria](M18-Real-Source-and-Follow-Up-Plan.md#m21-verify-the-integrated-release)

| Component | Observed |
| --- | --- |
| Host | Windows 11 Pro 25H2 AMD64 build 26200.9974. AMD Ryzen 7 5800X, 8 cores and 16 threads, 31.89 GiB physical RAM and 11.30 GiB available at preflight. |
| Docker | Desktop 4.99.0 (245822), Linux Engine and CLI 29.9.3, Compose 5.7.0, WSL 3.0.5.0 and kernel 6.18.58.1. Engine reported 16 CPUs and 15.56 GiB RAM. |
| Runtime | Container Python 3.12.14, Celery 5.6.3, PostgreSQL 17.12 and Redis 7.4.8. Alembic `0010 (head)` and no new upgrade operations. HTTP driver ran on Windows Python 3.13.14. |
| Candidate image | `collection-backend:m21c-f0ba4a3`, labelled with the revision, digest `sha256:c83541d965ef463e1369a441d7ecf62581184a9145285ab0a205cf89db160811`. The build reused cached dependencies and application layers. The benchmark and faults started with fresh named volumes. |
| Default limits | Docker inspect showed zero memory, memory-plus-swap, NanoCpus and CPU quota overrides. Redis `maxmemory` was 64 MiB with `noeviction`. Four live Celery replies showed prefork concurrency 1 and prefetch count 1 before measurement. Each trial checked its actual replica count and concurrency with the same image and Celery settings. |
| Background | 38 unrelated running containers remained in place. Their names and container IDs matched after the benchmark, fault and Demo sessions. Two unrelated fixtures sampled about 20% and 29% of one core at preflight, with others individually below 3%. Browser and fault checks were idle during the timed runs. |

| Purpose | Dedicated project | Loopback API / PostgreSQL / Redis | Subnets |
| --- | --- | --- | --- |
| Release benchmark | `collection-m3-test-m10-m21c-bench` | 58181 / 55581 / 16381 | 10.251.78.0/24 and 10.251.79.0/24 |
| Reliability | `collection-m3-test-m10-m21c-faults` | 58182 / 55582 / 16382 | 10.251.80.0/24 and 10.251.81.0/24 |
| M10 CSV follow-up | `collection-m3-test-m10-m21c-control` | 58183 / 55583 / 16383 | 10.251.82.0/24 and 10.251.83.0/24 |
| Candidate CSV follow-up | `collection-m3-test-m10-m21c-csv-check` | 58184 / 55584 / 16384 | 10.251.84.0/24 and 10.251.85.0/24 |

Existing projects included M21B Normal `adaptive-web-core-local-ca6affa7ed3a` and Demo `adaptive-web-core-demo-b273f8603cc5`, M18B Normal `adaptive-web-core-local-61e8e50ea0c3` and Demo `adaptive-web-core-demo-99f1d2efce00`, and `collection-m3-test-m20`. Their configuration and volumes were preserved. [M21B environment](M21B-Windows-Integrated-Acceptance.md#fresh-environment-and-launcher-evidence)

## Reliability

Each selected Python test executed and passed. The first invocation ran three tests in 54.43 s. The M20 invocation ran one test in 143.48 s and its two nested Chrome checks each passed. No selected tests skipped.

| Gate | Executed test | Observed outcome |
| --- | --- | --- |
| Shared origin | `test_m3_compose.py::test_m7_two_compose_workers_share_origin_and_preserve_detail_lineage` | **Passed.** Two simultaneous running Jobs had distinct claim owners. The controlled origin recorded 12 requests with a 1.005 s minimum completed-to-next-start gap. Both Jobs were Partial and preserved the expected detail and quarantine references. |
| Redis unavailable and restored | `test_m3_compose.py::test_compose_html_csv_broker_stop_and_named_volume_restart` | **Passed.** CSV Job `a5172a21-4e1d-4170-b9f8-60dc3a4052b0` remained Pending with `broker_unavailable` and no dispatch timestamp. Redis restoration allowed dispatch, one claim and one Partial publication with 2 accepted, 1 invalid and 1 duplicate. Redelivery logged `job_not_pending` and left the terminal Job and Events intact. |
| PostgreSQL restart and named volumes | `test_m3_compose.py::test_compose_html_csv_broker_stop_and_named_volume_restart` and the M20 case below | **Passed.** The controlled restart kept the same PostgreSQL volume and identical Job, Events, Source, pinned Profile, Record, quarantine and Evidence snapshots. In the first test raw HTML and CSV bytes matched in both API and Worker. M20 independently recomputed all five capture hashes after PostgreSQL, Redis, fixture, API, Dispatcher and Worker restarts. |
| Stale result and abandoned bytes | `test_m3_reliability.py::test_expired_attempt_cannot_publish_or_fail_a_new_claim` | **Passed.** The isolated PostgreSQL schema test rejected stale success and stale failure while attempt 2 held the claim. The stale `input.bin` remained on disk without a persisted Evidence row. Only the current attempt's Evidence reference was published. |
| Active Worker death, historical ownership, stale completion and duplicate | `test_m3_compose.py::test_m20_worker_attempt_identity_survives_recovery_and_restart` | **Passed.** After SIGKILL and real lease expiry, the same Job was redispatched to Worker B. Attempt 1 could not publish while B held attempt 2. The Job had exactly two claims and one terminal publication. Two accepted Records referenced their own detail captures and one quarantined Record referenced the invalid detail. Duplicate delivery changed none of the saved state. Chrome showed the same attribution before and after restart. |

Job `e752f2a3-f4b6-47a8-8983-d5db5f82fe7f` under Request `caee4b04-1b54-4997-b6b7-b71d2d039e60`. The table uses the REST event projection. A was `1f55050e-bbed-4c83-8104-e5aeb5359510` and B was `22e4c762-8bfb-4459-998f-817b71692c43`.

| HKT (UTC+8) | Event | Attempt | Worker | Outcome |
| --- | --- | ---: | --- | --- |
| 21:41:51 | JOB_CREATED | 0 | — | Pending |
| 21:41:52 | DISPATCHED | 0 | — | Pending |
| 21:41:54 | CLAIMED | 1 | A | Running, then killed with publication blocked |
| 21:43:24 | WORKER_LOST | 1 | A | Lease expired |
| 21:43:24 | RECOVERY_REQUESTED | 1 | A | Pending with `worker_lost`, zero published captures or Records |
| 21:43:29 | DISPATCHED | 1 | — | Pending |
| 21:43:29 | CLAIMED | 2 | B | Running. The stale publish probe returned `running 2` and changed no snapshot |
| 21:43:35 | PARTIAL | 2 | B | 2 accepted, 1 invalid, 0 duplicates, 5 published captures |

After the restart, Worker B's process had a new UUID (`2bb938e4-4541-4fc9-8f57-f3470321a88a`). Historical events retained A and B. Record Alpha's detail Evidence `55b7df79-780c-4768-90fb-48bf48643976` still hashed to `658567da9a416e8d35a572f656ced52bac1938a6cd530fe17f09d0cbc586dc16`.

### Reproduce the fault checks

Load `m10_environment.ps1` with the reliability row's project, ports and subnets plus frontend port 5192. Add the same image overlay and run the startup and migration commands in the scalability section. Verify the selected project's loopback API, PostgreSQL and Redis binds with `docker compose @composeArgs port api 8000`, `port postgres 5432` and `port redis 6379` respectively. Run the three nodes below before enabling the M20-specific settings. `scripts.require_pytest_pass` fails the invocation if a required test skips.

```powershell
python -m pytest -p scripts.require_pytest_pass -v -s -ra --tb=short `
  backend/tests/m2/test_m3_compose.py::test_m7_two_compose_workers_share_origin_and_preserve_detail_lineage `
  backend/tests/m2/test_m3_compose.py::test_compose_html_csv_broker_stop_and_named_volume_restart `
  backend/tests/m2/test_m3_reliability.py::test_expired_attempt_cannot_publish_or_fail_a_new_claim
```

For the M20 case, start from one Worker, append the M20 Worker override with `--max-tasks-per-child=1`, and recreate only that Worker. Set `M20_TEST_WORKER_IDENTITY=1`, `M20_DASHBOARD_DIR` to an absolute ignored output path, `M4_FRONTEND_PORT=5192` and `PLAYWRIGHT_CHANNEL=chrome`. Install the frontend lockfile before running its test node with the same pytest options. The lease, retry and pacing defaults are retained. [M20 Worker command and setup](M20-Worker-Attempt-Identity.md#how-to-repeat-the-run)

## Scalability

The existing M10 runner submitted Jobs through the normal loopback HTTP API, with replica rotation **1, 2, 4, 4, 1, 2, 2, 4, 1**. Each position used fresh approved fixture inputs and one CSV warm-up Job per replica. Timing starts before the first POST and ends when PostgreSQL polling observes the entire batch terminal. Execution span runs from the earliest stored claim to the latest stored finish timestamp. It can include gaps between Jobs and ends at a timestamp written within the terminal transaction. Latency runs from creation to finish. The nearest-rank p95 for a four-Job batch is the maximum. [M10 method](M10-Scalability-Evaluation.md#workloads)

| Workload | Per batch | Observed output in each batch |
| --- | --- | --- |
| Short | 48 alternating synthetic HTML and CSV Jobs | 48 captures including 24 HTTP pages and 96 accepted Records. Each of 24 CSV Jobs retained 3 quarantined rows and counted 1 duplicate. |
| CSV | 36 Jobs with 1,200 synthetic rows each | 36 dataset captures, 43,200 Records and zero duplicates or quarantined rows. |
| Shared origin | Four approved Cards fixture Jobs for `quick` | 4 Records, 8 HTTP page captures and the one-second shared-origin policy. Robots requests also use the interval. |

All 27 measured batches had the expected terminal statuses, counts and samples from every running service. Totals exclude warm-ups. There were 792 Jobs, 828 captures (288 HTTP pages), 389,700 accepted Records, 648 quarantined rows and 216 expected duplicates. The runner recorded zero unexpected Job errors, execution retries, dispatch retries, PostgreSQL deadlocks and temporary-file bytes. [Trial metrics and claims](M21C-results/scalability.csv) · [Trial resource peaks](M21C-results/scalability-resources.csv)

### Three-repetition medians

The Jobs/s ranges show the lowest and highest of three end-to-end rates. Speedup uses that workload's one-Worker median. Every trial reached the listed peak overlapping claims.

| Workload | Workers | Elapsed s | Jobs/s (range) | Records/s | Execution-span Jobs/s | Job p50 / p95 s | Speedup | Peak claims |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Short | 1 | 3.059 | 15.694 (15.232–15.722) | 31.4 | 20.815 | 1.677 / 2.633 | 1.000× | 1 |
| Short | 2 | 2.899 | 16.560 (16.267–17.405) | 33.1 | 21.363 | 1.525 / 2.466 | 1.055× | 2 |
| Short | 4 | 2.889 | 16.614 (16.025–17.986) | 33.2 | 21.070 | 1.464 / 2.511 | 1.059× | 4 |
| CSV | 1 | 10.304 | 3.494 (3.269–3.602) | 4192.5 | 3.845 | 5.543 / 9.610 | 1.000× | 1 |
| CSV | 2 | 6.631 | 5.429 (5.389–6.192) | 6514.6 | 6.507 | 3.253 / 6.004 | 1.554× | 2 |
| CSV | 4 | 3.571 | 10.081 (9.586–10.083) | 12097.8 | 14.503 | 2.059 / 3.121 | 2.886× | 4 |
| Shared origin | 1 | 11.835 | 0.338 (0.330–0.360) | 0.3 | 0.361 | 7.264 / 11.783 | 1.000× | 1 |
| Shared origin | 2 | 11.526 | 0.347 (0.346–0.353) | 0.3 | 0.361 | 8.256 / 11.484 | 1.027× | 2 |
| Shared origin | 4 | 11.716 | 0.341 (0.341–0.347) | 0.3 | 0.361 | 9.632 / 11.625 | 1.010× | 4 |

A post-run query found exactly one M20 `CLAIMED` event with a Worker UUID per measured Job. Claims were distributed 48/24/12 per replica for Short and 36/18/9 per replica for CSV at 1/2/4 Workers. Every replica claimed shared-origin work. At two Workers the split ranged from 1–3 claims per replica, and at four each replica claimed one Job.

### Docker resources

Each cell shows maximum sampled CPU in one-core units and maximum working set in MiB. Worker values are per replica. The two maxima can occur in different samples. CPU intervals can include the tail of a prior batch. The runner retained 2,752 in-window samples.

| Workload | Workers | Worker | PostgreSQL | Redis | Dispatcher | API | Fixture |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Short | 1 | 27.4% / 157.1 | 21.7% / 210.2 | 2.7% / 8.4 | 5.5% / 74.7 | 21.2% / 84.7 | 21.7% / 16.4 |
| Short | 2 | 29.8% / 156.2 | 27.6% / 201.5 | 3.5% / 5.8 | 5.5% / 74.7 | 22.7% / 84.6 | 23.9% / 20.2 |
| Short | 4 | 40.8% / 154.7 | 45.5% / 208.1 | 3.2% / 10.6 | 7.4% / 74.5 | 19.4% / 86.6 | 23.3% / 27.8 |
| CSV | 1 | 76.8% / 156.3 | 35.5% / 227.6 | 3.4% / 5.6 | 7.7% / 75.5 | 20.1% / 85.1 | 26.9% / 16.7 |
| CSV | 2 | 81.7% / 155.5 | 95.3% / 216.8 | 4.0% / 9.3 | 9.2% / 75.1 | 15.9% / 85.8 | 32.8% / 28.5 |
| CSV | 4 | 74.1% / 154.9 | 110.7% / 275.5 | 7.3% / 6.5 | 6.6% / 74.5 | 19.4% / 86.0 | 36.5% / 16.0 |
| Shared origin | 1 | 70.7% / 156.1 | 32.9% / 227.6 | 4.8% / 5.6 | 1.3% / 74.5 | 2.1% / 85.0 | 22.5% / 30.6 |
| Shared origin | 2 | 69.8% / 155.4 | 65.6% / 202.1 | 3.4% / 9.2 | 1.3% / 74.5 | 2.6% / 84.8 | 32.4% / 31.0 |
| Shared origin | 4 | 74.1% / 155.1 | 101.4% / 226.3 | 4.7% / 6.2 | 1.3% / 74.5 | 2.2% / 84.7 | 28.6% / 26.9 |

### Comparison with M10

| Workload | M10 Jobs/s at 1 / 2 / 4 | M21C Jobs/s at 1 / 2 / 4 | Change in medians |
| --- | ---: | ---: | --- |
| Short | 15.728 / 16.287 / 16.548 | 15.694 / 16.560 / 16.614 | −0.2% / +1.7% / +0.4%. All trial ranges overlap. |
| CSV | 3.821 / 6.414 / 9.528 | 3.494 / 5.429 / 10.081 | −8.6% / −15.4% / +5.8%. The candidate range was below M10 at one and two Workers. Four-Worker ranges overlap. |
| Shared origin | 0.341 / 0.345 / 0.348 | 0.338 / 0.347 / 0.341 | −0.9% / +0.6% / −2.0%. All trial ranges overlap. |

M10 reported the same host RAM, Docker versions and engine CPU/RAM allocation, pinned backend dependency versions and default service limits. M21C used a newer application image, including the attempt attribution and intervening schema changes. Both used fresh volumes and per-position warm-ups. Host caches and the workload from unrelated projects could vary across dates. Three repetitions describe variability on this host and these fixture sizes. [M10 results](M10-Scalability-Evaluation.md#results)

To investigate the CSV differences, two fresh projects ran the CSV workload alone with the same HTTP submission, warm-up and nine-position rotation. The control rebuilt reviewed M10 `7418a3b5132da091f10be564dddc8649de2c1fce` as `sha256:8a392f1b2a24c95e377e6e008b2f10e18eff449c2b6ed4ced96106d31f267da7`. The other project reused the M21C image. Each series had nine valid batches and per-service samples. These standalone runs omit the Short workload that preceded CSV in the full series. [M10 control trials](M21C-results/m10-csv-control.csv) · [M21C control trials](M21C-results/m21c-csv-control.csv)

| Workers | M10 CSV-only Jobs/s (range) | M21C CSV-only Jobs/s (range) | Median change |
| ---: | ---: | ---: | ---: |
| 1 | 3.519 (3.436–3.519) | 3.522 (3.324–3.587) | +0.1% |
| 2 | 6.075 (5.743–6.268) | 5.382 (5.055–5.967) | −11.4% |
| 4 | 10.286 (8.968–10.683) | 10.324 (9.001–10.521) | +0.4% |

The one-Worker difference against historical M10 disappeared in the same-host comparison. The two-Worker median remained lower, with overlapping rate ranges. At two Workers median submission took 0.338 s in M10 and 0.345 s in M21C. Median creation-to-dispatch was 0.546 s and 0.536 s, respectively. Median publication-to-claim increased from 1.857 to 2.542 s and median claim-to-finish increased from 121 to 141 ms. Each M21C replica still claimed exactly 18 Jobs per trial. The M20 code review found attribution fields added to the existing claim-event insert, with the Dispatcher unchanged. These measurements locate the difference after publication, with CPU scheduling, I/O, commit and acknowledgment costs unresolved. Two-Worker CSV throughput should remain visible in review. The measured four-Worker speedup in the full release series was 2.886×, and every CSV batch preserved correctness.

To reproduce the follow-up, use the same setup and startup commands in each checkout with the control projects in the environment table. In a local copy of the runner, keep `TRIAL_ORDER`, `scale`, `fixtures` and the CSV warm-up unchanged and iterate over `(("csv", cases["csv"]),)` in place of `cases.items()` in the measured loop. Write a new JSONL in each checkout. Compare the three per-topology medians for throughput and the publication-to-claim and claim-to-finish times in `job_details`.

- **Short Jobs.** Median creation-to-dispatch took 1.44–1.57 s, while claim-to-finish took 13–16 ms. A 48-Job burst takes at least three 20-Job polls. Extra Workers shorten claim wait while the one-second dispatcher cadence bounds the burst.
- **CSV.** Parsing, validation and large writes give Workers useful work to parallelise. Median publication-to-claim wait fell from 4.446 s to 1.988 s and 0.617 s. PostgreSQL reached 110.7% of one core at four Workers. Commit, acknowledgment, batching and shared database and Evidence writes contribute to the end-to-end time.
- **Shared origin.** Execution-span throughput stayed at 0.361 Jobs/s. Median claim-to-finish time went from 3.010 s to 5.028 s and 9.060 s as origin waits moved into concurrent executions. The approved one-second interval governs the request cadence at every replica count.

### Reproduce the default run

Use the tested application checkout and a local Python 3.12 or 3.13 virtual environment with `backend/requirements.txt` and pytest installed. Check free loopback ports and private subnets against Docker networks and Windows/VPN routes. Use a fresh project and JSONL filename for each repeat.

```powershell
$revision = git rev-parse HEAD
docker build --label "org.opencontainers.image.revision=$revision" -t collection-backend:m21c-f0ba4a3 .
New-Item -ItemType Directory -Force .local | Out-Null
@'
services:
  api:
    image: collection-backend:m21c-f0ba4a3
    environment:
      LOCAL_PROFILE_APPROVAL: "1"
  worker:
    image: collection-backend:m21c-f0ba4a3
  dispatcher:
    image: collection-backend:m21c-f0ba4a3
  collection-fixture:
    image: collection-backend:m21c-f0ba4a3
'@ | Set-Content .local/m21c-image.yaml
. ./backend/experiments/m10_environment.ps1 -Project collection-m3-test-m10-m21c-bench -ApiPort 58181 -PostgresPort 55581 -RedisPort 16381 -Subnet 10.251.78.0/24 -FixtureSubnet 10.251.79.0/24
$composeArgs += @('-f','.local/m21c-image.yaml')
$env:M3_TEST_COMPOSE_EXTRA_ARGS += ' -f .local/m21c-image.yaml'
docker compose @composeArgs up -d --no-build --wait postgres redis collection-fixture
docker compose @composeArgs run --rm --no-deps api alembic upgrade head
docker compose @composeArgs up -d --no-build --wait
docker compose @composeArgs exec -T api alembic check
python -m backend.experiments.m10_scalability --output .local/collection-m3-test-m10-m21c-bench/scalability.jsonl
```

After timing, use each batch's `job_details` IDs to select rows with `kind = 'CLAIMED'` in `execution_events` and group by `worker_instance_id`. The new raw `scalability.jsonl` hashed to `76ea54e4a022275f6f84f4bcfb483b1922c5b8e492d17776e12c460df443d3cc`. The tracked CSVs contain the data needed to recompute the medians. Raw JSONL, JUnit files, launcher settings, captures and browser artifacts are kept in ignored local directories.

## Constrained Demo and physical acceptance

The separate one-Worker experiment used project `adaptive-web-core-demo-770e0820f118` on the same 31.89 GiB host and 15.56 GiB Docker/WSL allocation. Diagnose reported Dashboard **http://127.0.0.1:5200/**, API **http://127.0.0.1:58100/api/v1**, PostgreSQL port **55500**, and networks `10.249.13.0/24` and `10.249.14.0/24`. The launcher built the tested tree into image `sha256:8e2c04e36e3260638370874b9acaf1f655c5f0a8d3f51472ebdb639103f399e0`. Docker Desktop and runtime dependencies were already available. This was a fresh Demo project with cached dependencies and build layers. Initial preset provisioning preceded application of the service caps. The measured phases and subsequent Stop/Start used the caps.

| Service | Memory and memory-plus-swap MiB | Idle peak MiB | Two-source collection peak MiB | Chrome inspection/export peak MiB |
| --- | ---: | ---: | ---: | ---: |
| API | 384 | 85.5 | 87.3 | 88.6 |
| Worker | 512 | 116.1 | 117.6 | 116.3 |
| Dispatcher | 256 | 74.0 | 74.0 | 74.0 |
| PostgreSQL | 256 | 47.3 | 54.3 | 55.4 |
| Redis | 128 | 4.7 | 4.9 | 4.4 |
| Fixture | 128 | 16.3 | 29.7 | 29.9 |
| **Project total, per-round range** | **1,664** | **341.4–343.7** | **352.7–367.2** | **351.5–368.6** |
| Available Windows RAM, GiB | — | 10.15–10.19 | 9.77–9.78 | 9.72–10.17 |
| Sampling rounds | — | 5 | 2 | 3 |

Each `docker stats --no-stream` round took about 1.72 s at the median, with a 0.3 s pause between rounds. Rounds crossing phase transitions were excluded. Service peaks can occur in different rounds. Project totals sum the six working sets in each round. The first idle round was 341.4 MiB and the first Chrome inspection round was 368.6 MiB. M16 reported approximately 348 and 353 MiB at its before and after points. The two observations use different sampling schedules. Docker inspect confirmed `MemorySwap` equalled `Memory` for each service, so the containers had no extra swap allowance. All six reported `OOMKilled=false` and restart count 0 before the run and after the intentional launcher restart. One real Worker reported a single prefork slot and prefetch count of one. [Per-round readings](M21C-results/constrained-memory.csv) · [M16 constrained check](M16-Final-MVP-Acceptance.md#verification-results)

Chrome 157 submitted `quick` with Demo Cards and Demo Catalog. Request `27055207-e015-457c-9549-defd510c3743` succeeded with one accepted Record from each source. CSV and JSON reconciled to exactly two REST Records, and both detail captures matched their metadata. The launcher stopped all project services and retained all four named volumes. Start reused the same volumes and container IDs with the same effective limits. Chrome reopened the Request, reached both detail Evidence entries and redownloaded byte-identical exports.

| Rechecked before and after Stop/Start | SHA-256 |
| --- | --- |
| Request CSV | `7ca562a394441bcf781d681db635022474f7e119e905d8b367aec08160b6ef1f` |
| Request JSON | `1badc1d4a411bffe90b82893becfffb92d21a74ed983bb196ba2025b658ba3ac` |
| Detail Evidence `c5b1d4bc-4631-45d7-866d-73ff400e2083` | `bbf25a9c35ea154e2e3b856679194ca5f37849345dbfafe2906e46edeac9b898` |
| Detail Evidence `93cee2fc-f519-4d29-9516-b943f51a2f4c` | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` |

For reproduction, use a fresh checkout and `Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser`, then `Diagnose-Platform.bat -Demo -NonInteractive`. Read the new project name from its private `.local-demo/launcher.env`. For each of the six services identify exactly one running container using both the project and service labels, then apply the table's limit with `docker update --memory <MiB>m --memory-swap <MiB>m <container-id>`. Inspect `HostConfig.Memory`, `HostConfig.MemorySwap`, `State.OOMKilled` and `RestartCount` before measurement and after restart. Record `docker stats --no-stream --format '{{json .}}' <project-container-ids>` and Windows available memory at idle, during collection and during Chrome inspection/export. Use `python -m backend.experiments.m18b_reconcile --port <api-port> <request-id> <download.csv> <download.json>` and compute `sha256sum /data/evidence/<id-without-hyphens>/input.bin` inside the Worker. Repeat the checks after `Stop-Platform.bat -Demo -NonInteractive` and `Start-Platform.bat -Demo -NonInteractive -NoBrowser`. [Windows setup](../setup/Windows-One-Click-Setup.md)

**Not run – physical host unavailable.** On an authorised physical Windows 11 AMD64 machine with about 8 GB installed, record physical and available memory, free disk, Windows/WSL/Docker Desktop/Node versions and existing application load. Record whether Docker Desktop was stopped and whether base images, build layers, frontend dependencies and volumes were cached. Use a fresh isolated checkout and one Worker. Run Setup and first Demo Start sequentially and time Start until the Dashboard and API are usable. Keep Docker Desktop and the browser active. Measure available memory, commit and disk paging before Setup, at readiness and during both two-source `quick` and `detail404` collections. Record Docker/WSL, browser and Node working-set peaks and project `docker stats`, responsiveness, OOM flags and unexpected restarts. After normal launcher Stop/Start verify the same Request IDs, downloads, capture hashes and named volumes. Confirm a repeated Start reuses the frontend. Repeat under ordinary coursework load and preserve unrelated data. [M10 physical procedure](M10-Deployment-Verification.md#physical-8-gb-acceptance)

## Release matrix

| Priority or release gate | Verdict | Tested revision and evidence |
| --- | --- | --- |
| Reusable Core, approved inputs, platform positioning and modular monolith architecture | Verified in an earlier reviewed milestone | M19 `65b8e7363f0c3fca7629d20627a67c8fce389d72`. The React/FastAPI/PostgreSQL/Redis/Celery system collects from approved inputs, validates and exports Records with lineage. The Core runs without an external LLM, and the downstream industry application remains open. [Product scope](../../PRODUCT.md) · [System overview](../architecture/System-Overview.md) |
| Three independent successful HTTPS publishers | Verified in an earlier reviewed milestone | M21B application `fbb5393`, evidence `f0ba4a3`. Welsh Government, Scottish Fiscal Commission and Economics Observatory each had a succeeded Worker Job, one accepted Record and hash-verified HTTP 200 detail Evidence. [Publisher Jobs and hashes](M21B-Windows-Integrated-Acceptance.md#approved-profiles-and-succeeded-publisher-jobs) · [M18B acceptance](M18B-Live-Multi-Source-Acceptance.md) |
| Shared-topic collection with accepted Records from two live origins | Verified in an earlier reviewed milestone | M21B `fbb5393`. Dashboard Request `519a9d94-4584-4705-bbde-8b772dd2bbf0` and qualifying MCP Request `b602799d-d532-403e-bb27-c7151974b83e` both collected `inflation` and retained one Record each from Welsh and Scottish publishers. Scottish was Partial after hitting its detail limit. The first MCP run lost Scottish to a timeout. [Live Dashboard/MCP comparison](M21B-Windows-Integrated-Acceptance.md#dashboard-and-mcp-comparison) |
| Per-source Evidence and request-scoped CSV/JSON exports on live sources | Verified in an earlier reviewed milestone | M21B `fbb5393`. Both qualifying Requests reconciled 2 Records in each format against REST. Record → Job → Source/Profile → detail Evidence and bytes matched. [M21B evidence and exports](M21B-Windows-Integrated-Acceptance.md#dashboard-and-mcp-comparison) |
| Dashboard and actual MCP stdio, submission and retry | Verified in M21C | `f0ba4a3`. Chrome submitted two fixture Jobs and downloaded both formats. Real MCP stdio returned HTTP 201, replayed with HTTP 200 and recovered an intentionally dropped post-commit reply using the same IDs. [Walkthroughs](#presenter-walkthroughs) |
| Controlled HTTP retry parity across both entry points | Verified in an earlier reviewed milestone | M21B `fbb5393`. The isolated fixture produced an HTTP 503 on attempt 1. Each original Job completed on attempt 2, preserving its lineage and export scope. [M21B retry reproduction](M21B-Windows-Integrated-Acceptance.md#teammate-walkthrough) |
| Per-attempt Worker identity, failure recovery and stale/duplicate fencing | Verified in M21C | `f0ba4a3`. A killed Worker retained its claim history and the second Worker published the only terminal result for that Job. Broker outage and duplicate tests also passed. [Reliability](#reliability) |
| Durable Jobs, Records, Evidence and exports | Verified in M21C | `f0ba4a3`. Fault-test snapshots and hashes survived service restart. The constrained Dashboard Request retained two Records, both detail digests and identical CSV/JSON bytes across launcher Stop/Start. [Reliability](#reliability) · [Constrained Demo](#constrained-demo-and-physical-acceptance) |
| Fresh Windows Demo and separate empty Normal installation | Verified in an earlier reviewed milestone | M21B `fbb5393`. Sequential first installs, diagnosed alternate ports and distinct named volumes. 11 Requests and 17 Jobs survived launcher restart across both modes. [M21B integrated acceptance](M21B-Windows-Integrated-Acceptance.md) |
| Default 1/2/4-Worker capacity and approved origin limit | Verified in M21C | `f0ba4a3`. 27/27 expected batches, real replica and claim verification, verified one-second spacing. [Scalability](#scalability) |
| Constrained one-Worker Demo | Verified in M21C | `f0ba4a3`. All six cap and swap settings persisted. No OOM flag or unexpected restart. Peak sampled total was 368.6 MiB. [Constrained Demo](#constrained-demo-and-physical-acceptance) |
| Physical approximately 8 GB Windows 11 AMD64 acceptance | Not run | Physical host unavailable. [Remaining acceptance procedure](#constrained-demo-and-physical-acceptance) |
| Hosted PR workflow | Not run | M21A `fbb5393` supplied the workflow and local contract evidence. Hosted run pending an authorised Draft PR. [M21A PR verification](M21A-PR-Verification.md) |
| Integration to main | Not run | Independent review and merge pending. [Hosted verification and handoff](#hosted-verification-and-handoff) |

## Presenter walkthroughs

Run first-time Demo and Normal dependency installation **sequentially**. In M21B, simultaneous first setup hit `WEB-001` while both launchers were installing the same frontend lockfile. Let the first mode finish before setting up the second. Use the current ports printed by Diagnose if they differ from this run. [M21B sequential setup](M21B-Windows-Integrated-Acceptance.md#fresh-environment-and-launcher-evidence)

### Dashboard

1. Start the isolated Demo, run Diagnose, and open **http://127.0.0.1:5200/**. In **New Collection**, choose **Core Demonstration → Fixture Listings**. Select **Demo Cards** and **Demo Catalog**, enter `quick`, review the two pinned sources and select **Start topic collection**.
2. Open the Request and show both Succeeded child Jobs. Follow **View request records** to an accepted Record from each source, then open its capture Evidence and compare the displayed SHA-256. Return to the Request and download CSV and JSON. The verified M21C Request was `27055207-e015-457c-9549-defd510c3743`, with one Record per source and identical exports after Stop/Start. These are synthetic fixtures.
3. For real-publisher evidence, open the reviewed M21B Normal Dashboard at its diagnosed **http://127.0.0.1:5217/**. The saved `inflation` Request linked in the release matrix has one accepted Record from Welsh Government and one from Scottish Fiscal Commission. M21B also recorded a separate succeeded Scottish Job and a succeeded Economics Observatory Job. [M21B publisher and Dashboard evidence](M21B-Windows-Integrated-Acceptance.md#dashboard-and-mcp-comparison)

### Actual MCP stdio

1. From the checkout root, use a Python environment installed from `mcp_access/requirements.txt` and set `FYP_MCP_API_BASE=http://127.0.0.1:58100/api/v1` for the M21C Demo. Connect your local client with `python -m mcp_access.server` over stdio. The verifiers use the MCP SDK to launch that server. [Windows MCP setup](../setup/Windows-MCP-Access.md)
2. Call `list_categories`, `list_topics` and `list_topic_sources`. Choose Demo Cards and Demo Catalog for Fixture Listings. Call `prepare_collection` for `quick`, save the complete `submission` and use it with `start_collection` after operator approval. The verified Request `c06fae94-73b7-45df-b024-841d541f3ccf` returned HTTP 201. Replaying the saved intent returned HTTP 200 with the same Request and Job IDs. The verifier also dropped a real post-commit reply through a local proxy. Resending its saved key returned the existing Request `ea54f34b-5112-45ec-82fb-51f75e181758` and left the inventory unchanged.
3. Call `get_collection_status`, `get_collection_records`, `get_record_lineage` and `get_evidence_metadata`. Open the returned Request ID in the Dashboard. In the controlled `detail404` scenario, Request `08c62d45-4c9c-4abe-a951-c1d3087aeccc` finished Partial, with one accepted Record and a recorded HTTP 404 per source. The actual SDK read the persisted Dashboard Request after restart. M21B's reviewed live-publisher MCP example used its separate Normal API on **58117**.

```powershell
$env:FYP_MCP_API_BASE = 'http://127.0.0.1:58100/api/v1'
python -m mcp_access.verify_demo 27055207-e015-457c-9549-defd510c3743
python -m mcp_access.verify_start_demo
python -m pytest -p scripts.require_pytest_pass -q -ra mcp_access/tests
```

Run the write verifier only in your isolated Synthetic Demo, with no concurrent collection operators. Use your Request ID for the read verifier. Both SDK verifiers passed and the MCP unit/protocol suite passed 14 tests in 11.02 s. The frontend TypeScript and Vite production build passed. `pip check` passed in the isolated environments. [MCP verifier guide](../setup/Windows-MCP-Access.md#submit-one-topic-collection)

## Hosted verification and handoff

The GitHub connector returned zero open PRs and zero PR-triggered Actions runs for M21A `fbb5393c6d5c5c3e347671223acdf9717994081b` or M21B `f0ba4a32368b36f5038a0d35f8ccb9d382aa2707`. The fetched `main` was `1b1ed19fe03670dac57a6006d3b1a5be149700b0`, the M17 merge. A standalone feature-branch push does not exercise the PR workflow. In the subsequent review, open a Draft PR from `feature/M21C-release-evaluation` to `main`, assign an independent teammate, and record the hosted run URL, head and checked-out merge SHA, and individual job outcomes. Physical 8 GB acceptance remains a separate gate. [M21A hosted verification](M21A-PR-Verification.md#hosted-verification) · [Repository Actions](https://github.com/coffee030/adaptive-web-data-collection-platform/actions)
