# M0 Core Contracts

以下為概念 contracts。欄位名稱是跨 service／adapter 的語意，實際 SQL schema、API DTO 和 deployment 留待相關 milestones。以 opaque ID 參照 entities，時間以 UTC 記錄，快照及 payload 帶版本。

| 概念 | 欄位 | 不變條件 |
| --- | --- | --- |
| Source | `source_id`, `source_name`, `adapter_type`, `allowed_origins`, `permission_reference`, `approval_status` | `web` 來源有 exact origin allowlist 及授權紀錄。`csv` 以資料集使用授權和匯入邊界管理。暫停或撤銷授權時停止發出新請求。 |
| Source Profile Version | `profile_version_id`, `source_id`, `version`, `extraction_config`, `record_type`, `schema_version`, `validation_status`, `approval_status`, `config_hash` | 版本在同一 Source 下唯一。Draft 修改後先前 validation 失效。Validation report 記錄當前 hash、樣本及結果。人手 approval 必須針對同一已驗證 hash，並保存 approver、時間及決定。批准後內容不可變。Retire 只改變可用狀態，歷史仍可查。 |
| Generic Record | `record_id`, `record_type`, `schema_version`, `source_record_key`, `payload`, `source_position`, `evidence_reference`, `provenance` | Payload 欄位以 `record_type` 和 `schema_version` 解讀。來源位置為 DOM record index／key 或 CSV row reference。Dedup 規則和 Task idempotency 各有明確作用。 |
| Evidence | `evidence_id`, `source_reference`, `task_reference`, `profile_version_reference`, `original_location`, `captured_at`, `content_hash`, `storage_reference`, `metadata` | 保存可核對的原始位元組和 SHA-256。Web metadata 記錄 requested／final URL、狀態、允許保留的 headers 和 attempt。CSV metadata 記錄 dataset ID、encoding 和 import 資料。Storage reference 由系統管理。 |
| Collection Job | `job_id`, `source_id`, `profile_version_id`, `status`, `created_at`, `started_at`, `finished_at`, `error_summary` | 建立時同時檢查 Source 授權及指定 Profile 的 validation／approval，確認兩者對應同一 `source_id`。Job 固定使用該版本及 config hash。 |
| Collection Task | `task_id`, `job_id`, `input_key`, `status`, `attempt_count`, `idempotency_key`, `error_code` | `input_key` 由 canonical page URL 或 dataset 分段定位。Queue payload 傳 `task_id`，worker 從 durable state 取資料。Attempt、錯誤、終態和重複交付有明確紀錄。 |

## Profile 與授權流程

`draft → preview → validate → human approval → approved version → job`。Preview 可輸出有限樣本、selector match counts、欄位錯誤及 evidence reference，仍受 Source Access Policy 約束。新設定由 draft 產生新版。新 Job 於 transaction 內鎖定 source、profile version 和驗證 snapshot 的一致性。Worker 執行前重新檢查當前來源授權，並使用 Job 固定的 extraction version。人手撤銷來源時，定義 in-flight 的中止邊界，保留既有 evidence 和 audit。

## 共用 ingestion 與 durable execution

- Web adapter 讀取已核准 HTTP 頁面，轉成 candidate payload、來源位置和 evidence。CSV adapter 從受限匯入取得同形 candidate，保存原始檔及 row reference。兩者共用 schema validation、normalization、quarantine、record dedup 和 storage。CSV 契約保留授權、dataset version、大小及格式限制。
- PostgreSQL 保存 Job、Task、attempt 和 outcome。FastAPI 建立 durable Job／Task 後才讓 Celery 派送。Dispatch 失敗要留下可重試狀態，避免 DB 成功而 queue 工作遺失。Worker 確認寫入結果或失敗後才 acknowledge，重複派送由 conditional transitions 及唯一 idempotency key 控制。Queue payload 和事件只帶安全的 identifiers／診斷。
- 初步 Task 狀態為 `pending → queued → running → succeeded/failed`。有界 transient retry 記錄每次 attempt，返回可派送狀態。Job 由 task outcomes、dispatch 狀態和明確的 partial failure 規則導出。取消、排程與 recovery 規則在後續設計時定案。
- Evidence bytes 先安全寫入再發布 metadata 或 Record。若 evidence 不完整，保留診斷並阻止成功狀態。使用 hash 驗證內容、分離權限並保存來源、版本、Job、Task、時間和驗證結果。
- FastAPI transport 和 Celery task wrapper 可共用 Python services 及 domain functions，各自建立 transaction／session。Scrapling wrapper 和 CSV import 是 adapters。ML／IA 經有版本的 Core Records 介面讀取資料，應用欄位與分析結果由下游管理。

## 待決定

- `config_hash` 的 canonical serialization、Profile approval 權限和驗證報告樣本及門檻。
- Record identity 的 schema／source namespace、更新語意、跨來源 dedup，以及 quarantine 後的修復流程。
- Evidence 容量、retention、刪除、存取授權、孤兒清理和 raw payload 保存政策。
- Job 的 partial success／cancel、DB-to-queue dispatch 選型、fencing、索引及 migration 策略。
- CSV dialect、encoding、資料集大小限制，以及各 schema 的發布與相容性。
