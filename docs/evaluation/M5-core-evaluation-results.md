# M5 Core Evaluation Results

2026-11-14（HKT）。Windows 11 25H2 build 26200、16 logical CPUs；Docker Desktop 4.99.0、Engine 29.9.3、Compose 5.7.0、WSL2 Linux 6.18.58.1、16 vCPU、16709967872 bytes。CPython 3.12.14、Node 22.18.0／npm 10.9.3、PostgreSQL 17 Alpine、Redis 7.4.8、Celery 5.6.3、Scrapling 0.5.1。隔離 project `collection-m3-test-m5-20261114`，localhost API 58095。兩個拓撲同一機器和 image，其他既有使用者服務當時仍可運行。命令及 sample sizes 見 [evaluation plan](M5-core-evaluation-plan.md) 和 [runbook](../demo/M5-core-demo-runbook.md)。本機 raw output 位於 `var/m5-local/evaluation-workers{1,2}.json`。

## Extraction and integrity

預期值由人手讀取 fixture 後寫入 runner。兩種拓撲合計 28 Jobs（每拓撲 2 個 labelled 初始 Jobs＋12 個 warm Jobs），HTML／CSV 各 14。每 Job 比對 status、欄位、位置、error codes、counts、lineage、SHA-256、event sequence 和原 key replay。同一 Job 的有效 keys 皆唯一。

| Fixture | 預期／實際候選 | 接受 | 拒絕 | Duplicate | 欄位比對 |
| --- | ---: | ---: | ---: | ---: | --- |
| HTML `table.html` | 2／2 | 2 | 0 | 0 | 4/4。Item 1 `c3 / River Walk`，item 2 `d4 / Lake View`。 |
| CSV `listings.csv` | 6／6 | 2 | 3 | 1 | 10/10，包括 boolean、integer 和 optional null。有效實體行 2、3；行 4 duplicate（保留行 2）；行 5 required title、6 wrong count type、7 invalid width。 |

每 topology 由 Evidence volume 直接讀取兩個初始 Jobs 的 bytes，和 fixture 比對，共四份。其餘 24 warm Jobs 每筆比對 API SHA-256、lineage 及完整有效欄位；無額外或漏掉的 accepted 輸出。

| 一個 worker 的可回查樣本 | Job ID | Evidence ID | SHA-256 |
| --- | --- | --- | --- |
| HTML | `d85d8fca-a07e-4130-bfa3-4237998b0cf6` | `7bed65a8-262a-4dc2-8f9f-5b9c987d5afd` | `5d65fc9aec1cc428b872490e5e1d7049e947c47fcafb0f38eb535316940162e0` |
| CSV | `250cd104-2acd-47c0-9be6-75b84e1c24be` | `e41207d0-cbe1-469c-8b2c-86ed190770d4` | `15ad900bbc23656d0049eeb4dc48c51b501cd9d24cce4976876b8f138b02acfa` |

## Timing and concurrency

第一個隔離環境的 image build 為 2.524 s（cache 命中）；由空 PostgreSQL 到 migration、API ready 為 11.540 s（M4 baseline）。最終 image 用另一組全新 volumes 重跑為 11.295 s，首個 HTML Job `fbfa1400-d2f5-4651-85a1-43e444cfe962` 見到終態耗時 727.86 ms，POST 10.87 ms，DB execution 27.81 ms。該 Job 前已透過 API 設置及驗證 Profile。CSV Job `f698d380-93b9-415c-9a49-1aa35d94b135` 為 964.82 ms 並帶相同 fixture checksum。修正版另一次全服務 stop/start 到 health 為 5.623 s。

| Warm latency (ms) | 1 replica min／median／max (n=12) | 2 replicas min／median／max (n=12) |
| --- | ---: | ---: |
| POST Job | 10.63／18.79／43.69 | 11.48／19.06／28.23 |
| GET Job detail，觀察終態那次 | 2.39／7.34／9.62 | 3.73／8.12／9.44 |
| GET Records | 3.39／5.67／9.67 | 3.39／5.26／9.29 |
| DB created → dispatch publication | 632.92／870.80／881.37 | 548.27／864.23／909.72 |
| DB started → finished | 7.53／10.37／13.87 | 7.86／10.58／27.55 |
| Client Job submit → observed terminal | 685.07／929.61／1006.92 | 612.22／932.89／1018.69 |

12 個 warm Jobs（4 in flight × 3，以確認結果和 replay 為批次終點）用 2.789 s／2.728 s。吞吐為 **4.30／4.40 Jobs/s**，或 **8.61／8.80 accepted Records/s**。兩個 workers 回覆 Celery ping，兩者的 load-interval CPU 抽樣上升。每筆只見一次 claim 和一次 terminal。2／1 worker 吞吐約 **1.02×**，本次 fixture 未達 Proposal 1.5×。本樣本的 dispatch wait 明顯長於 execution duration，且波幅與約 1 s Dispatcher polling 一致。每拓撲僅一輪，4 workers、飽和吞吐、長期 SLO 和 internet-scale 沒有相應實驗。

| In-process extraction + validation | Bytes | Candidates | 1-worker session min／median／max (ms) | 2-worker session min／median／max (ms) |
| --- | ---: | ---: | ---: | ---: |
| HTML | 272 | 2 | 0.190／0.208／0.249 | 0.194／0.213／0.239 |
| CSV | 151 | 6 | 0.080／0.084／0.121 | 0.079／0.080／0.103 |
| Generated CSV | 11697 | 500 | 4.907／5.028／15.011 | 4.923／5.068／14.937 |

各 1 次 warmup、10 次計時。以上是同一 Windows host Python 的單程序 microbenchmark，以 `perf_counter` 計時，排除 web I/O、Evidence 和 PostgreSQL。各 session 只代表兩次重跑。

## Container resource observations

每拓撲在 seed 後及 warm workload 時段各取一次 `docker stats --no-stream`。RAM 為 MiB，CPU 為 Docker 每 service 抽樣百分比，僅代表抽樣窗口。

| Service | Limit MiB | 1 worker idle → load MiB | 1 worker load CPU | 2 workers idle → load MiB | 2 workers load CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| API | 256 | 78.03 → 80.52 | 17.32% | 78.80 → 80.93 | 18.39% |
| Fixture | 128 | 13.05 → 14.11 | 0.23% | 13.36 → 13.58 | 0.22% |
| Dispatcher | 256 | 73.50 → 73.51 | 1.09% | 73.51 → 73.52 | 1.10% |
| PostgreSQL | 512 | 37.18 → 44.30 | 5.66% | 44.50 → 48.27 | 5.57% |
| Redis | 128 | 4.47 → 5.00 | 0.43% | 5.07 → 4.90 | 0.41% |
| Worker 1 | 512 | 113.20 → 115.40 | 4.45% | 113.70 → 114.60 | 2.13% |
| Worker 2 | 512 | — | — | 91.06 → 114.50 | 2.62% |

單 worker 合計限額 1792 MiB，load sample 約 333 MiB；兩 workers 2304 MiB，sample 約 450 MiB。限額及使用量只涵蓋表中容器。實體 8 GB Windows 驗收延期。

獨立 Vite demo process 在四個 viewport 的 44 次 Impeccable renders 前／後量得 working set 84.94／113.22 MiB，process peak 140.92 MiB。71.69 s 內累計 CPU time 增加 1.56 s。這是 Node process 本身的觀測，瀏覽器及 Docker VM 另耗資源。

## Recovery and maintainability

Baseline 真實 SIGKILL case 的 lease expiry 後 179 ms 出現 `WORKER_LOST`，再過 5.122 s 由 attempt 2 完成。PostgreSQL restart retained named volume，Redis outage case 回 `broker_unavailable` 後完成，原始 evidence 與資料列可核對。Final gate 的實際 fault evidence 見 [test results](../experiments/M5-test-results.md)。Timing 代表個案。

依 [architecture review](../architecture/M5-core-architecture-review.md) 核對 adapter／application／queue／persistent layers、migration constraints、版本鎖、log sanitization、受控配置和錯誤。API schema 與 [consumer contract](../contracts/M5-downstream-integration-contract.md) 用實際 FastAPI routes 和 OpenAPI 反查。Python requirements 為 pinned，前端有 npm lockfile。現行限制包括未分頁的 Events、跨 process filesystem／DB commit 邊界和單一 Dispatcher polling。
