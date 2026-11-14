# M5 Downstream Integration Contract

M6／M7 的資料入口為可信本機 `/api/v1`。各應用使用 REST JSON 及各自的 domain schema。Core 保留原資料及 lineage，應用以自己的 storage 持有 import checkpoint、衍生屬性及分析結果。Source access、Profile Approval 都是獨立操作。在運行的 API origin 開啟 `/openapi.json` 取得 machine-readable schema。 [M4 Closure contract](M4-closure-api-contract.md)

## Supported routes

以下省略 `/api/v1`。

| Resource | Routes |
| --- | --- |
| Health | `GET /health` 檢查 PostgreSQL。Queue health 依 Dispatcher／Worker 和 events 檢查。 |
| Source | `GET`／`POST /sources`、`GET /sources/{source_id}`、`PATCH /sources/{source_id}/authorization`。 |
| Profile | `GET`／`POST /sources/{source_id}/versions`、`GET`／`PUT /sources/{source_id}/versions/{version_id}`、同版本的 `POST /preview`、`/validate`、`/approve`、`/retire`。 |
| Job | `GET`／`POST /collection-jobs`、`GET /collection-jobs/{job_id}`、`GET /collection-jobs/{job_id}/events`。 |
| Record | `GET /records?job_id=…&limit=…&offset=…`、`GET /records/{record_id}`。 |
| Quarantine | `GET /collection-jobs/{job_id}/quarantine?limit=…&offset=…`。 |
| Evidence | `GET /evidence/{evidence_id}`、`GET /collection-jobs/{job_id}/evidence`，有 Job 但無 capture 時後者回 200 `null`。 |

Job POST 必填 `source_id`、`profile_version_id`、`entry`。HTML entry 傳 `adapter_type: "web"` 及 `url`；CSV 傳 `adapter_type: "csv"`、`dataset_id` 及 UTF-8 `content`。Source POST 必填 `source_name`、`adapter_type`、`permission_reference` 和相應的 `allowed_origins` 或 `allowed_datasets`。API Source 建立可接收指定授權狀態，預設 pending；Console 流程用 terminal PATCH。Source／Job 建議各提交 UUID `request_key`，初次 201，同內容重送 200，內容衝突 409。同一 Job key 以 Source 為 scope，Source 建立 key 全域唯一。這兩個 key 不出現在成功 DTO。Approval 須有 `approver`、`report_id`、`config_hash`。Draft PUT 要求 `configuration` 和 `expected_revision`，遺漏 428，過期 409。

## DTO and lineage

下表列出所有回應欄位。「可為 null」欄位仍在 JSON。寫入模型與回應 DTO 分開。

OpenAPI response schema 的 `required` 由 Pydantic defaults 決定。Source 的 `approval_status`／兩個清單、Profile 的 status／approval 欄位、Provenance 的 `validation_status` 有 defaults，runtime response 一樣序列化這些欄位。CreateSource 在 OpenAPI 只標記三個共用欄位必填，adapter 對應 allowlist 由 runtime policy 驗證。DraftEdit 在 OpenAPI 將 `expected_revision` 列為 nullable default，實際寫入 Draft 必須提交。

| DTO | 必有內容 | 可為 null | Mutability |
| --- | --- | --- | --- |
| Source | `source_id, source_name, adapter_type, permission_reference, approval_status, allowed_origins, allowed_datasets` | 無。對應清單至少一項，另一個清單空。 | API 只改 `approval_status`（pending／approved／revoked）。 |
| ProfileSnapshot | `source_id, profile_version_id, version, revision, configuration, config_hash, approval_status` | `approved_by, approved_at, validation_report_id` 在 Draft 為 null，核准後必有值。 | Draft revision 從 1 遞增。Approved／Retired 的身份、配置、hash 和 approval audit 固定，approved 可退役。 |
| Job | `job_id, source_id, profile_version_id, config_hash, status, created_at, valid_count, invalid_count, duplicate_count, execution_attempt, dispatch_attempts` | `started_at, finished_at, error, lease_expires_at, next_attempt_at, dispatch_due_at, last_dispatched_at, dispatch_error_code` | Source／Profile／hash 和提交身份固定；狀態、attempt、時間及 counts 由 orchestrator 更新到終態。 |
| ExecutionEvent | `event_id, job_id, status, occurred_at` | `kind, execution_attempt, error`；歷史事件的 kind／attempt 可為 null。 | 順序採 API array order（DB sequence），events 為 append-only。 |
| Record | `record_id, job_id, source_id, profile_version_id, record_type, schema_version, deduplication_key, payload, source_position, validation_status, evidence_reference, provenance, created_at` | `source_record_key`。Payload 個別 optional 欄位可為 null。 | 發布後無 update API。Payload 值為 scalar（string／integer／number／boolean／null），`validation_status=passed`。 |
| QuarantinedRecord | `record_id, job_id, source_id, profile_version_id, evidence_reference, source_position, problems, created_at` | `problems[].field`。每個 problem 有 `code`、`message`。 | 發布後無 update API；ID 指 quarantine entry。Duplicates 另計，無相應 quarantine row。 |
| Evidence | `evidence_id, job_id, source_id, profile_version_id, config_hash, run_id, captured_at, content_hash, adapter_type, original_location` | `requested_location, http_status, content_type`。 | 每 Job 至多一份已發布 capture，metadata 無 update API。HTML location 為 URL，CSV 為 dataset ID。 |

`Record.provenance` 必含 `source_id, run_id, profile_version_id, config_hash, validation_status`。Record／Quarantine 的 `source_position` 必含 `kind, index`，取 1-based HTML 擷取項次或 CSV 起始實體行。CSV 表頭及 multiline 欄位計入行號。Source／Profile 及 nested provenance 常用無連字號 UUID；Job、Record、Quarantine、Evidence 的外層 UUID 為 hyphenated。以 UUID 等值比較。時間含 UTC offset。HTTP error 使用 `error.code`、`message`；request validation 可有 `fields`。Job/event error 有 `code, message, http_status, retry_after_seconds`，後兩項可為 null。

## Consumption protocol

1. 以既有已授權 Source 和 Approved Profile 提交，持久保存 `job_id`、immutable Profile pin 和 request intent。提交不確定時以原 key 與原 payload 重播。需要恢復或重取舊 Job 時，直接讀 Job ID。
2. 輪詢 Job detail 至 `succeeded`、`partial` 或 `failed`，並用 events 判斷 dispatch／failure。Pending 及 running 尚可重試。只在終態讀取最終 counts。
3. `succeeded` 可載入通過驗證的 Records；`partial` 由 app policy 決定是否接收其 valid subset，保存 invalid／duplicate counts 和 Quarantine link。 `failed` 記錄 failure，若 capture 仍在可用 Evidence metadata 診斷。只有 Records API 回傳的 validated payload 進入 app。
4. 以明確 `job_id` 查 `GET /records`，`limit=100`，每次增加實際收到的筆數，短頁結束並核對 `valid_count`。跨 Job 的全域 live offset query 可能移位。終態 Job 的結果行在既有 API 下固定，適合逐 Job checkpoint。
5. 下游 import 冪等鍵使用 Core `record_id`，同一 Job 的重取重用相同 ID。每 Job first-valid-wins，`deduplication_key` 是 Source／record type／schema version／identity 或 payload 的 SHA-256。新 Job 可保存同一 identity 的新 snapshot。下游自訂跨 Job 的 versioning 規則。
6. 衍生資料保存 Core `record_id`、Job、Source、Profile、config hash、Run、Evidence ID 及 Evidence content SHA-256。分清原始資料和 app 加工欄位。保留輸入 schema version，並按 app 自己的映射版本演進。

Jobs／Records／Quarantine 的預設頁長 50，最大 100，offset 上限 2147483647。Jobs 支援 `status` filter；Records 支援 `job_id`。Source／Profile／Events 無 server-side pagination。現有 API 範圍外包括 cancel/pause、worker fleet state、total counts、global Quarantine/Evidence 清單、cursor pagination、全域搜尋或 CSV／raw Evidence download。Job 即使重派仍受 commit fencing 保護，受控 HTTP request 可能重做。

M6 可自行定義 review text、rating 及 provenance mapping。M7 待 requirements 決定 input、policy、payload 和 matching interface。兩者都可用本文件的讀取及 lineage contract 進行後續設計。
