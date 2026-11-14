# M3 Readiness Review

Windows 原生回歸和 Linux Docker Gates A–E 已通過。最新整合證據與資源抽樣見 [M3 Test Results](M3-test-results.md)。

| Definition of Done | 狀態 | 證據 |
| --- | --- | --- |
| M0／M1／M2 regression | PASS | 修改前 134 tests，完整回歸保留 |
| Docker environment checked | PASS | Windows 11 Pro 25H2 build 26200，WSL2 正常，Docker Engine 29.9.3 回報 linux |
| M2 PostgreSQL named-volume persistence | PASS | PostgreSQL 17.12 container 正常重啟後保留同一 named volume、資料與 Evidence |
| Redis starts and responds | PASS | Portable Redis 7.4.8 回傳 PONG，Celery/Kombu 連線成功 |
| Worker receives real broker tasks | PASS | Linux Celery 5.6.3 prefork Worker、實際 Redis 7.4.8 queue |
| Worker delegates to M2 executor | PASS | 批准的 Source／Profile 經 `JobExecutor` 和 M1 pipeline |
| FastAPI creates asynchronously executed Job | PASS | 真實 API、Dispatcher、broker 和 Worker 跑受控 HTML／CSV |
| Job durable before dispatch | PASS | Job、input、event、dispatch intent 在同一 PostgreSQL transaction |
| Redis publication failure leaves durable Job | PASS | 同一測試 port 的 Redis 停止及重啟，先記錄失敗，再成功派送 |
| Duplicate publication safe | PASS | SQL rollback 後重派及並行 Dispatcher |
| Duplicate delivery preserves committed results | PASS | Active／terminal duplicates 和未 ack 恢復，唯一結果及終態事件 |
| Worker failure recovery | PASS | Linux Worker container 遭 SIGKILL，實際 90 秒 lease 到期後 attempt 2 成功 |
| Stale Worker cannot overwrite results | PASS | 真實 PostgreSQL fence 測試，包含 lease 過期、重新 claim 及舊完成／失敗 |
| Bounded retry | PASS | 3 個 execution attempts、backoff、超額終態，Redis outage 不消耗 execution budget |
| Access blocking stops requests | PASS | 受控 403 和 challenge，維持 robots 和 origin bounds |
| PostgreSQL authoritative state | PASS | Worker、Dispatcher 及 API 共用 DB，Celery backend 停用 |
| Evidence and record traceability | PASS | 單筆 metadata，Job／Profile／Run lineage、原始 bytes 和 SHA-256 |
| HTML／CSV integrations | PASS | Linux Compose 的 HTML 產出 2 筆有效 Records，CSV partial 有 2 筆有效、1 筆 quarantine 和 1 筆 duplicate |
| Broker／Worker failure checks | PASS | Linux Compose Redis 停止後重派、Worker SIGKILL 復原與重複訊息跳過 |
| Container restart preserves records and evidence | PASS | 服務重啟後 PostgreSQL snapshot、共享 Evidence bytes 及 SHA-256 一致 |
| Real Redis／Celery integration | PASS | Linux prefork Worker 已登記並執行 collection.execute_job |
| Resource usage measured | PASS | 六個 Linux 容器單次抽樣合計約 313 MiB。8 GB 主機的整機可用性待實測 |
| Ruff and migrations | PASS | Ruff lint／format、Alembic 0005／check，含既有 pending、running、terminal rows 升級 |
| Documentation reflects results | PASS | Architecture、Contract、ADR、Test Results、Manifest、README |
| M3 scope preserved | PASS | 未新增 React、ML 或 IA 相關功能 |

### 歷史環境阻擋

本機早前因 firmware virtualization 未啟用而跳過兩個 Compose 案例。現已確認 virtualization 可用，Docker Desktop 已成功啟動 Linux Engine。既往結果保留在 [M3 Test Results](M3-test-results.md)。

### 結案決定

**M3 GO / M4 GO。** Gates A–E 通過，最後一次完整回歸 172 passed、0 failed、0 skipped。M4 可先以 React + TypeScript 製作 Collection Jobs 清單與 detail，直接接既有 Jobs、Events 和 Records API，並沿用 Impeccable Skill、PRODUCT.md 和 DESIGN.md。約 8 GB 主機的整機使用情況仍需另行量測。
