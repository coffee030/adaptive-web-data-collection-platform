# M2 REST API Contracts

此為原 M2 合約。現行 Source POST replay、Draft conditional PUT、Evidence 與 loopback HTTP contract 另見 [M4 Closure API Contract](M4-closure-api-contract.md)。

開發入口為 `http://127.0.0.1:8000`，OpenAPI 位於 `/openapi.json` 和 `/docs`。資料路由使用 `/api/v1`。Operator identity 由本機呼叫者提供，用於 audit。此環境依賴 localhost 與可信操作者。

| Method | Path（省略 `/api/v1`） | 行為 |
| --- | --- | --- |
| GET | `/health` | 以 `SELECT 1` 檢查 DB 連線 |
| POST, GET | `/sources` | 新增及列出 Source |
| GET | `/sources/{source_id}` | 查詢 Source |
| PATCH | `/sources/{source_id}/authorization` | 改變 Source access status |
| POST, GET | `/sources/{source_id}/versions` | 新增 Draft 及按版本號列出 |
| GET, PUT | `/sources/{source_id}/versions/{version_id}` | 查詢版本或更新 Draft |
| POST | 同上加 `/preview` | 最多五筆 candidates |
| POST | 同上加 `/validate` | 保存 report，回傳 `passed`、counts、錯誤、sample hash 及 config hash |
| POST | 同上加 `/approve` | 以 `approver`、`report_id`、`config_hash` 批准當前 Draft |
| POST | 同上加 `/retire` | 將已批准版本退役，保留原審批及歷史 |
| POST, GET | `/collection-jobs` | 建立 pending Job 及分頁查詢 |
| GET | `/collection-jobs/{job_id}` | Job 狀態、pinned version、時間、counts、error |
| GET | 同上加 `/events` | 按 sequence 列出狀態事件 |
| GET | 同上加 `/quarantine` | 有 evidence 引用及規則錯誤的分頁清單 |
| GET | `/records`、`/records/{record_id}` | 分頁或查詢單筆；清單可按 `job_id` 過濾 |
| GET | `/evidence/{evidence_id}` | 相對 storage reference、原始資料 SHA-256、來源、Run 和 Job lineage |

Source 建立需要 `source_name`、`adapter_type`、`permission_reference` 和 policy。Source access 可為 `pending`、`approved` 或 `revoked`，預設 `pending`。Web 使用 `allowed_origins`，每筆為明確的 `http://127.0.0.1:PORT`。CSV 使用 `allowed_datasets`。Profile 的 POST／PUT body 是 `{"configuration": {...}}`，configuration 沿用 M1 discriminated union。Source 和 Profile DTO 以 Core UUID hex 字串輸出，Job 和結果 DTO 以帶連字號的 UUID 輸出。UUID 路徑接受兩者。

Preview、Validation 和 Job 的受控輸入相同。Web 格式是 `{"adapter_type":"web","url":"http://127.0.0.1:8001/table.html"}`。CSV 格式是 `{"adapter_type":"csv","dataset_id":"listings","content":"Name,Count\nAlpha,2\n"}`。CSV 以 UTF-8 text 傳入，編碼後限 1 MiB，支援 BOM。API 不接受 server path、檔名或任意 URL。Preview 及 Validation 會讀取受 M1 限制的單份樣本。Collection Job 建立只保存輸入與固定版本，交由獨立 CLI 執行。

Job POST 的欄位有 `source_id`、`profile_version_id`、`entry` 及可選的 UUID `request_key`。首次建立回傳 201。同一 Source、key、版本及相同輸入再次提交時回傳現有 Job 和 200。重用 key 提交不同版本或輸入回傳 409。不同 key 或略去 key 會建立新的 Job。Job 終態為 `succeeded`、`partial` 或 `failed`。分頁使用 `limit`（1–100，預設 50）和 `offset`（預設 0）。

所有業務及請求錯誤使用 `{"error":{"code":"…","message":"…"}}`。422 額外回傳 `fields` 的位置與類型。400 表示業務輸入不合規，403 表示存取不獲授權，404 表示 ID 找不到，409 表示 approval／Job conflict，413 表示 request body 超限，503 表示暫時無法連接 PostgreSQL。API responses 不顯示 database credentials、raw CSV request body 或 stack trace。
