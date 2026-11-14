# M5 Core Test Results

2026-11-14，香港時間。測試使用 M5 修正版、CPython 3.12.14、PostgreSQL 17.12、Redis 7.4.8、Celery 5.6.3、Node 22.18.0 和 Playwright 1.65.0。完整環境與 ports 見 [evaluation results](../evaluation/M5-core-evaluation-results.md) 及 [runbook](../demo/M5-core-demo-runbook.md)。

## Baseline and repair

| Check | 實跑結果 |
| --- | --- |
| M4 delivery backend 原始 suite | 176 passed，216.18 s，零 skipped。依實際 PostgreSQL／Redis／Celery 包含 Linux worker kill、broker restart 和 named volume persistence。 |
| M4 delivery Chromium controlled | 78 passed，55.0 s。 |
| M4 delivery Chromium live | 13 passed，1 failed，59.0 s。Jobs 測試計算所有後代 `listitem`，把 `DISPATCH_FAILED` 的 nested error code 算作第六件事件，API 回的是五個 events。 |
| Batch B defect reproduction | 三個新 tests 有意驗證既定要求，基線均失敗。原 URL robots 檢查與 libcurl 實際 URL 正規化不同，Scrapling log 有 synthetic marker，HTML 擷取結果缺少 aggregate text budget。 |
| Batch B focused regression | 120 passed，11.24 s。包含 literal／encoded dot-segments、encoded slash、redirect recheck、safe logging、size bound，及真實 PostgreSQL 的 Source replay、Draft concurrency、attempt fencing、failure classification。 |
| Chromium 同一故障 Job rerun | 2 passed，3.9 s。測試仍逐件要求 event count/order，並核對 nested error code。 |

## Final regression

| Gate | 實跑結果 |
| --- | --- |
| Full backend | **182 passed**，219.96 s，零 skipped。包含 real PostgreSQL、Redis broker、native Celery 及 Linux prefork Compose。 |
| TypeScript、Vite | PASS。Vite 8.3.8 build 54 modules，143 ms；JS 399.09 kB（gzip 119.36 kB）。 |
| Chromium controlled | **78 passed**，55.6 s。 |
| Chromium live Docker | **14 passed**，1.4 min。Source registration／authorization、Draft edit、Preview／Validation／Approval、HTML／CSV、pinned Job、failure replay、durable data／Evidence 實測。包含 14 個 UI states × 4 widths（1440／1280／768／390px），56 次 axe A/AA、無 reported violations；global overflow checks 通過。 |
| Firefox 159 live representative | **6 passed**，26.6 s。 |
| WebKit 27.2 live representative | **6 passed**，34.0 s。Windows Playwright engine。 |
| Firefox／WebKit controlled polling | 各 **2 passed**，16.8 s／17.2 s。首個補跑指令選錯 spec 而收集 0 tests；corrected command 使用 `job-create.spec.ts`，原 assertions 原樣執行。 |
| Ruff、pip check、Alembic | PASS。Ruff 59 files 已格式化，pip dependencies 無 broken requirements。兩個隔離 DB 均達 `0006 (head)`，`alembic check` 無 drift。 |
| Impeccable source | PASS，4.9.0／engine 0.1.23，`[]`。 |
| Impeccable rendered | PASS，Chrome 157.0.8103.51，1440×900／1280×900／768×900／390×844 各掃 11 個 real Console routes，合共 44 renders，四輪均 `[]`、exit 0。 |
| Cold-start final image | PASS。獨立 fresh project `collection-m3-test-m5-cold-final` 到 API ready 11.295 s；已註冊 `collection.execute_job`。14 個實際 Jobs 完成 fixture checks；全部六服務正常退出 0／OOM=false。 |
| Final shutdown | PASS。主要 M5 驗收 project 的六個服務亦 exit 0／OOM=false；三個 named volumes 均保留。 |

## Recovery and integrity evidence

| 情境 | 預期與實際行為 |
| --- | --- |
| Redis stop/start | Compose 在 Redis 關閉期間仍回 201 並持久化 pending、`DISPATCH_FAILED`、`broker_unavailable`。Job `01f8420b-5842-4bd4-9783-84bb462c6adc` 自 `DISPATCH_FAILED` 到 `DISPATCHED` 為 9.017 s，到 `PARTIAL` 為 9.402 s，包含測試觀察及服務重啟等待。恢復後取得一份已發布結果（CSV partial 2／1／1）。實際重送同一 task 後 worker log 為 `job_not_pending`，Job 和 events 原樣保留。 |
| Worker 終止及 lease | Final live Docker Job `5f6a5244-a321-479a-9c59-bb41b5705215` 在 publication 等待 SQL lock 時 SIGKILL worker container。90 s lease 的期限為 13:35:06.683086Z，13:35:06.875329Z 記錄 `WORKER_LOST`（+0.192 s），attempt 2 於 13:35:12.002006Z 完成（再 +5.127 s）。僅一次 terminal、單筆有效 Record、實際 evidence bytes 相符。 |
| SQL outage／service restart | Real PostgreSQL restart 之後仍掛載原 `collection-m3-test-m5-20261114_postgres_data`。受控 Worker claim DB failure 直到恢復才可 claim。Chromium CSV workflow 在 DB 停止時回 503 `database_unavailable`，恢復後同 key 201／200 定位 `443633c9-66f4-4bbf-b4e2-2bcc42676bc9`，七個原有結果的 snapshots 相同。另一次整組 stop/start 到 health 5.623 s，6 個 API body 相同，三個 volumes 保留，CSV checksum 與原檔相同。 |
| Bounded execution retry | SQL 和受控 HTTP tests 核對 timeout／transport／DB transient、HTTP 429／5xx、Retry-After 和固定 backoff。第 3 次 attempt 為上限。授權、robots denial、明確 blocking、configuration、validation、非暫時性 persistence/evidence errors 為結果或終態；Redis 派送復原與 execution budget 分開。 |
| PostgreSQL transaction fence | 已驗證 stale attempt 無法提交或把新 claim 標為 failed、兩 workers 爭同一 Job、commit rollback 無半份結果、過期 lease 才復原、重送恢復保留輸入及 pin。 |
| Data lineage | Approved config trigger、Draft concurrent 200／409、Source 201／200 replay 及 key conflict、Job scoped 一個 capture、跨 Job evidence FK、HTML item／CSV physical line、SHA-256 tamper detection、failed Evidence-only lookup 通過。 |
| Local security | HTTP foreign Host／Origin／null 拒絕，same-origin 和可信 terminal 正常；destination/dataset guard、redirect policy、robots、1 MiB input 及 HTML value bound、metadata path 和 no raw bytes route、503 safe envelope 各有實測或 code review。Compose API／PG host loopback；Redis host port 僅驗收 overlay 的 loopback。 |

Outage／recovery 個案各執行一次於 final suite。PostgreSQL restart 時間與 Worker lease elapsed 表示單次本機觀測。可用性不包含整台主機斷電、資料毀損或多服務同時長期中斷。

Chromium 以真實 API 完成的 HTML Job 為 `fe52e8bd-893f-4b77-94eb-77d3f2404892`，Evidence `ed83ef18-06c5-4dad-968a-8e374a5594cf`，結果 2／0／0；CSV Job 為 `575a1f7c-79a7-4dc6-992e-0bf9302c4259`，Evidence `5729a681-8b33-4cec-83f4-60604bc47aa5`，結果 2／3／1。兩份 Evidence SHA-256 均與 evaluation table 的原始 fixtures 相同。

目視複核 CSV Job 390 px、Records 1440 px、Evidence 768 px 的實際 Playwright captures。Status/counts、長 ID、水平表格捲動、hash 和 lineage 在抽查視窗可閱讀。

## Reproduction

```powershell
# Repo root，先配置並啟動隔離 Compose。確保環境和 runbook 一致。
.\.venv\Scripts\python.exe -m pytest -q -rs --tb=short -s backend/tests
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m ruff format --check backend
.\.venv\Scripts\python.exe -m pip check
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
.\.agents\skills\impeccable\scripts\impeccable.cmd detect --json frontend/src
# frontend/，controlled: M4_REAL_API=0；live: M4_REAL_API=1，配置 loopback proxy。
npm.cmd run typecheck
npm.cmd run build
npm.cmd test -- --workers=2
# live suites 必須串行，避免 restart tests 同時中斷服務。
npm.cmd test -- --workers=1
# PLAYWRIGHT_BROWSER=firefox 或 webkit
npm.cmd test -- tests/core-workflow.integration.ts tests/closure.integration.ts tests/sources.integration.ts --workers=1
# 代表性 polling，M4_REAL_API=0。
npm.cmd test -- tests/job-create.spec.ts --grep poll --workers=1
```

M5 在 repo root 使用已安裝的 engine `.agents/skills/impeccable/scripts/bin/windows-x64/impeccable.exe detect --json --viewport <WxH> @urls`，`PUPPETEER_EXECUTABLE_PATH` 指向本機 Chrome，Vite 為 5199。選 11 條 URL，包括 Job list/new/detail、Quarantine、Source list/new/detail、Approved Profile、Record list/detail、Evidence。 [Rendered 指令範例](M4-E-acceptance.md#ux-and-accessibility-findings)

完整 logs、評估 JSON、rendered checks 及失敗證據在本機 `var/m5-local/` 和 `frontend/test-results/`。實機和人工項目記在 [Post-M5 checklist](Post-M5-device-acceptance-checklist.md)。
