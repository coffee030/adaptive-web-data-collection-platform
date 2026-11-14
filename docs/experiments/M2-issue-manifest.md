# M2 Local Issue Manifest

基線為 `cd7c681`。工作分支為 `feature/M2-persistent-backend-core`。Git 無 remote，Issue、Project、PR 及同儕審查待有目標後追蹤。

| Issue / Batch | Objective / Scope | Dependencies | Implementation tasks | Tests / Acceptance criteria | Definition of Done |
| --- | --- | --- | --- | --- | --- |
| M2-01 / A PostgreSQL and SQLAlchemy Foundation | 本機 DB 與 schema migration | M1 基線 | Compose、環境變數、session、Alembic | 真 PostgreSQL 可連線；空 DB 可升級；FK 和 UNIQUE 可驗證 | migration 檢查、啟停及測試文件齊全 |
| M2-02 / A Persistent Sources and Profile Versions | 持久化 Source policy 與 profile snapshot | M2-01 | ORM mapping、版本唯一、UTC 與 JSONB | 重連後可讀取同一 nested config/hash；並行建立版本遞增 | 保留 M1 contracts 及 regression suite |
| M2-03 / B Transactional Validation and Approval | 原子保存驗證與審批 | M2-02 | Report、revision fence、row lock、審批與 retirement | stale/failed report、撤銷、rollback、並行審批及 immutable config 通過 | 審批 audit 可重讀，並發策略已文件化 |
| M2-04 / B FastAPI Source and Profile APIs | 版本化 transport | M2-03 | Source／Profile 路由、error envelope、health 與 OpenAPI | 正常與錯誤狀態、response schema、持久化通過 | 路由共用 application service，文件可重現 |
| M2-05 / C Persistent Collection Jobs and State Transitions | Job 固定已批准版本，獨立 claim | M2-03 | Job、event、state machine、CLI entry point | 拒絕未批准、retired、跨 Source profile；並行 claim 只成功一次 | Job 和 events 可重讀，API 只建立 Job |
| M2-06 / D Evidence and Generic Record Persistence | 保存結果、quarantine 和原始資料索引 | M2-05 | Evidence FK、record identity、quarantine、atomic publish | 檔案 hash、缺失或 rollback、重複 work、跨 Source 正確 | 結果有完整 lineage，孤兒處理已文件化 |
| M2-07 / D Controlled Execution and REST Results APIs | 完成 HTML／CSV vertical slices | M2-04 至 M2-06 | M1 Runner、CLI、paged records、evidence metadata | 真 PostgreSQL、HTTP fixture、CSV fixture 與檔案全流程 | 能透過 REST 讀回狀態與結果 |
| M2-08 / E Integration Testing, Reliability and M3 Readiness | 驗證整體與交接 | M2-01 至 M2-07 | Regression、restart、migration QA、readiness | 記錄實際測試、重啟及限制 | 明確列出完成、阻塞和 M3 建議 |

設計順序為 `sources → profile_versions → profile_validation_reports`，接上 `collection_jobs` 與 `execution_events`，再加入 `raw_evidence`、`generic_records` 和 `quarantined_records`。M2 每個 Job 執行單一受控輸入，以 Job 作為 claim 單位。M0 的多 Task 派送屬後續範圍。SQL 使用 UUID 關聯，Core 的 Source domain ID 在 M2 由應用層以 UUID hex 提供。M1 呼叫端仍可用既有的字串 ID。

- Batch A 通過 115 項測試及 Alembic upgrade/check。Compose 容器驗證待 Docker 環境。
- Batch B 通過 122 項測試及 Alembic upgrade/check，包含 stale report、rollback、並行審批、DB immutable trigger 和 FastAPI。
- Batch C 通過 15 項 M2 測試及 Alembic upgrade/check。Job 固定版本及 hash，CLI claim 與狀態事件使用獨立交易。
- Batch D 通過 20 項 M2 測試及 Alembic upgrade/check，涵蓋兩種 adapter、結果 lineage、重送、缺失 evidence 與交易回滾。
- Batch E 通過 134 項測試、Uvicorn／CLI 和原生 PostgreSQL restart。M2-08 的 Compose named-volume 驗收待 Docker 環境。
