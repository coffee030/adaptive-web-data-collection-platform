# M5 Core Evaluation Results

On 2026-11-14 (HKT), Windows 11 25H2 build 26200 had 16 logical CPUs. Docker Desktop 4.99.0 used Engine 29.9.3, Compose 5.7.0, WSL2 Linux 6.18.58.1, 16 vCPU, and 16709967872 bytes. Other versions were CPython 3.12.14, Node 22.18.0, npm 10.9.3, PostgreSQL 17 Alpine, Redis 7.4.8, Celery 5.6.3, and Scrapling 0.5.1. The isolated project was `collection-m3-test-m5-20261114` with localhost API 58095. The two topologies shared the machine and image. Other existing user services could still run. Local raw output was saved to `var/m5-local/evaluation-workers{1,2}.json`. [Evaluation plan](M5-core-evaluation-plan.md) [Runbook](../demo/M5-core-demo-runbook.md)

## Extraction and integrity

Expected values were entered into the runner after reading the fixtures manually. The two topologies ran 28 Jobs in total, 2 labelled initial Jobs and 12 warm Jobs per topology, with 14 HTML and 14 CSV. Each Job was checked for status, fields, position, error codes, counts, lineage, SHA-256, event order, and replay with its original key. Valid keys were unique within each Job.

| Fixture | Expected and actual candidates | Accepted | Rejected | Duplicate | Field comparison |
| --- | ---: | ---: | ---: | ---: | --- |
| HTML `table.html` | 2／2 | 2 | 0 | 0 | 4/4。Item 1 `c3 / River Walk`，item 2 `d4 / Lake View`。 |
| CSV `listings.csv` | 6/6 | 2 | 3 | 1 | 10/10, including boolean, integer, and optional null. Physical lines 2 and 3 were valid. Line 4 duplicated line 2, which was retained. Line 5 lacked a required title, line 6 had the wrong count type, and line 7 had invalid width. |

Bytes for the two initial Jobs per topology were read directly from the Evidence volume and compared with fixtures, four captures in total. Each of the other 24 warm Jobs was checked for the API's SHA-256, lineage, and all valid fields. No accepted outputs were added or missing.

| Traceable sample with one worker | Job ID | Evidence ID | SHA-256 |
| --- | --- | --- | --- |
| HTML | `d85d8fca-a07e-4130-bfa3-4237998b0cf6` | `7bed65a8-262a-4dc2-8f9f-5b9c987d5afd` | `5d65fc9aec1cc428b872490e5e1d7049e947c47fcafb0f38eb535316940162e0` |
| CSV | `250cd104-2acd-47c0-9be6-75b84e1c24be` | `e41207d0-cbe1-469c-8b2c-86ed190770d4` | `15ad900bbc23656d0049eeb4dc48c51b501cd9d24cce4976876b8f138b02acfa` |

## Timing and concurrency

The first isolated environment built the image in 2.524 s with a cache hit and took 11.540 s from empty PostgreSQL through migration to API readiness for the M4 baseline. Rerunning the final image with another fresh set of volumes took 11.295 s. The first HTML Job `fbfa1400-d2f5-4651-85a1-43e444cfe962` reached an observed terminal state in 727.86 ms, with POST at 10.87 ms and DB execution at 27.81 ms. The Profile was configured and validated through the API beforehand. CSV Job `f698d380-93b9-415c-9a49-1aa35d94b135` took 964.82 ms with the same fixture checksum. A separate stop and start of all corrected services reached health in 5.623 s.

| Warm latency (ms) | 1 replica min／median／max (n=12) | 2 replicas min／median／max (n=12) |
| --- | ---: | ---: |
| POST Job | 10.63／18.79／43.69 | 11.48／19.06／28.23 |
| GET Job detail at the terminal observation | 2.39/7.34/9.62 | 3.73/8.12/9.44 |
| GET Records | 3.39／5.67／9.67 | 3.39／5.26／9.29 |
| DB created → dispatch publication | 632.92／870.80／881.37 | 548.27／864.23／909.72 |
| DB started → finished | 7.53／10.37／13.87 | 7.86／10.58／27.55 |
| Client Job submit → observed terminal | 685.07／929.61／1006.92 | 612.22／932.89／1018.69 |

The 12 warm Jobs (4 in flight × 3, with each batch ending after result and replay confirmation) took 2.789 s and 2.728 s. Throughput was **4.30 and 4.40 Jobs/s**, or **8.61 and 8.80 accepted Records/s**. Both workers answered Celery ping and their CPU samples rose under load. Each Job showed one claim and one terminal event. Two-worker versus one-worker throughput was about **1.02×**, below the Proposal's 1.5× target for this fixture. Dispatch wait was much longer than execution, with variation consistent with roughly 1 s Dispatcher polling. Each topology ran once. Four workers, saturation throughput, long-term SLOs, and internet-scale workloads were untested here.

| In-process extraction + validation | Bytes | Candidates | 1-worker session min／median／max (ms) | 2-worker session min／median／max (ms) |
| --- | ---: | ---: | ---: | ---: |
| HTML | 272 | 2 | 0.190／0.208／0.249 | 0.194／0.213／0.239 |
| CSV | 151 | 6 | 0.080／0.084／0.121 | 0.079／0.080／0.103 |
| Generated CSV | 11697 | 500 | 4.907／5.028／15.011 | 4.923／5.068／14.937 |

Each case had one warm-up and 10 timed runs. These single-process microbenchmarks ran on the same Windows Python host with `perf_counter` and excluded web I/O, Evidence, and PostgreSQL. Each session represents only two reruns.

## Container resource observations

For each topology, capture `docker stats --no-stream` once after seeding and once during warm load. Memory is in MiB. Docker CPU percentages for each service describe the sampled window.

| Service | Limit MiB | 1 worker idle → load MiB | 1 worker load CPU | 2 workers idle → load MiB | 2 workers load CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| API | 256 | 78.03 → 80.52 | 17.32% | 78.80 → 80.93 | 18.39% |
| Fixture | 128 | 13.05 → 14.11 | 0.23% | 13.36 → 13.58 | 0.22% |
| Dispatcher | 256 | 73.50 → 73.51 | 1.09% | 73.51 → 73.52 | 1.10% |
| PostgreSQL | 512 | 37.18 → 44.30 | 5.66% | 44.50 → 48.27 | 5.57% |
| Redis | 128 | 4.47 → 5.00 | 0.43% | 5.07 → 4.90 | 0.41% |
| Worker 1 | 512 | 113.20 → 115.40 | 4.45% | 113.70 → 114.60 | 2.13% |
| Worker 2 | 512 | — | — | 91.06 → 114.50 | 2.62% |

The one-worker limit totalled 1792 MiB with about 333 MiB sampled under load. Two workers totalled 2304 MiB with about 450 MiB sampled. Limits and use cover only the listed containers. Acceptance on a physical 8 GB Windows computer was deferred.

The separate Vite demo process used 84.94 and 113.22 MiB of working set before and after 44 Impeccable renders across four viewports, with a peak of 140.92 MiB. CPU time increased by 1.56 s over 71.69 s. These measurements cover Node. The browser and Docker VM also consume resources.

## Recovery and maintainability

The real baseline SIGKILL case recorded `WORKER_LOST` 179 ms after lease expiry. Attempt 2 completed a further 5.122 s later. PostgreSQL restart retained the named volume. The Redis outage case recovered after `broker_unavailable`, and original Evidence and rows remained verifiable. The timing refers to these cases. [Final-gate fault evidence](../experiments/M5-test-results.md)

The review checked adapter, application, queue, and persistence layers, migration constraints, version pins, log sanitisation, controlled configurations, and errors. The team checked the API schema and consumer contract against FastAPI routes and OpenAPI. Python requirements are pinned and the frontend has an npm lockfile. Limits included unpaginated Events, the filesystem and DB commit boundary across processes, and polling by a single Dispatcher. [Architecture review](../architecture/M5-core-architecture-review.md) [Consumer contract](../contracts/M5-downstream-integration-contract.md)
