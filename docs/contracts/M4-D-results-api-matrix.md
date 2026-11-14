# M4-D API Contract Matrix

以下保留 M4-D 歷史合約。現行 API 支援 Job-scoped Evidence lookup，並省略 `storage_reference`。見 [M4 Closure API Contract](M4-closure-api-contract.md)。

基線為 M4-C 文件提交 `bb7c856`。已核對 FastAPI routes、實際服務的 `GET /openapi.json`、本機 `create_app().openapi()`、M1 ingestion／evidence、M2 migration `0004` 和 M3 Job 結果發布流程。以下 API 路徑省略 `/api/v1`。

| 能力 | API | 合約及導航 |
| --- | --- | --- |
| Records List | `GET /records` | `Record[]`。可選 UUID `job_id`，無匹配時回空陣列。按 `created_at, id` 排序。 |
| Record Detail | `GET /records/{record_id}` | 同一 `Record` DTO，以 persisted UUID 查詢。未知 ID 回 404。 |
| Evidence Detail | `GET /evidence/{evidence_id}` | 以 UUID 查詢 `Evidence`。未知 ID 回 404。 |
| Quarantine List | `GET /collection-jobs/{job_id}/quarantine` | `QuarantinedRecord[]`。按 position index、ID 排序。未知 Job 回 404。 |
| Job Link | `GET /collection-jobs/{job_id}` | 三個結果 DTO 均有 `job_id`。Job 提供狀態、獨立三組 counts 及 pinned Profile。Events 有獨立 endpoint。 |
| Source Link | `GET /sources/{source_id}` | 三個 DTO 均有 `source_id`。Source 詳情從既有頁面查詢。 |
| Profile Version Link | `GET /sources/{source_id}/versions/{version_id}` | 三個 DTO 均有 Source ID 和 Profile Version ID。版本號、approval status 及批准紀錄由既有 Profile 頁面載入。 |
| Job → Evidence | 經 Job scoped `/records` 或 `/quarantine` | Job DTO 沒有 Evidence ID。可用結果列上的 `evidence_reference`。只保存 Evidence 而沒有結果列的 Job 缺少 API lookup。 |
| Evidence → Records | `GET /records?job_id=…` | 可開啟同 Job 的有效 Records。M2 schema 對每個 Job 限制一份 Evidence，Records／Quarantine 的 composite FK 綁定同一 Job 和 Evidence。沒有 evidence ID filter 或 reverse index。 |
| Raw Evidence Retrieval | Unsupported | 本機 store 可驗證 bytes，但沒有 HTTP raw/download route。UI 省略內部 `storage_reference`。 |
| Global Evidence / Quarantine, full-text search, totals | Unsupported | Evidence 由結果連結或 ID 路由開啟。Quarantine 屬 Job。沒有全文查詢、總筆數或跨 Job Quarantine。 |

兩個結果清單使用 `limit` 1–100（預設 50）及 `offset` 0–2147483647（預設 0）。未提供 total，前端用 page size + 1 判斷 Next。非法 UUID／分頁回 422，DB 連線錯誤回 503。這些 GET 沒有 write conflict 流程。Job／Results UUID 序列化有連字號，Source／Profile DTO 使用 hex。FastAPI 路徑同時接受兩者。

- **Record** 保存 `record_id`、`job_id`、`source_id`、`profile_version_id`、`record_type`、`schema_version`、nullable `source_record_key`、`deduplication_key`（SHA-256）、`payload`、`source_position`、固定 `validation_status: passed`、`evidence_reference`、`created_at` 和 `provenance`。Payload 實際為 scalar object，含 string、integer、number、boolean、null；JSON viewer 另支援 nested JSON 顯示。Provenance 包含 Source、Run、Profile Version ID、config SHA-256 及 validation status。
- **QuarantinedRecord** 含 `record_id`（quarantine entry UUID）、Job／Source／Profile Version ID、`evidence_reference`、`source_position`、`created_at`、`problems[]`。Problem 含 `code`、nullable `field` 和 `message`。CSV position 是 candidate 起始實體行，表頭及多行欄位影響行號。HTML position 是從 1 起計的擷取項次。Duplicates 在 Job count 單列，由 persistence 只寫入 invalid candidates 的規則與 quarantine 區分。
- **Evidence** 含 Evidence、Job、Source、Profile Version、Run ID、`config_hash`、`captured_at`、`content_hash`、`content_type`、`adapter_type`、`original_location`、`requested_location` 和 `http_status`。最後三個 HTTP／content 欄位中，requested location、HTTP status 和 content type 可為 null。CSV 的 original location 為 dataset ID。位置屬 Record 或 Quarantine，Evidence 描述整份 capture。Metadata 另含內部 `storage_reference`，前端不渲染。顯示 backend 記錄的 SHA-256，瀏覽器未重算原始 bytes。
