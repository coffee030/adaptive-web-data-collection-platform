# M4-E Job Submission Contract

M4 Closure 沿用 Job submission contract，補充 Draft、Source、Evidence、loopback 和 pagination 行為。參見 [M4 Closure API Contract](M4-closure-api-contract.md)。

已核對 checkout 的 `create_app().openapi()`、隔離 FastAPI 的 `GET /openapi.json`、`backend/api/jobs.py` 與 `backend/application/jobs.py`。POST operation 及 CreateJob、WebEntry、CsvEntry、Job、ExecutionEvent 五個 schemas 一致。OpenAPI 列出 200、201、422。其他 domain errors 由 application exception handlers 回傳。

| Operation | Request and result |
| --- | --- |
| GET `/api/v1/sources` | 回傳 Source 和真實的 `approval_status`、adapter、allowed origins／datasets。 |
| GET `/api/v1/sources/{source_id}/versions` | 回傳版本歷史。Draft、Approved、Retired 可辨識，只有 Approved 可為新工作提交。 |
| POST `/api/v1/collection-jobs` | UUID `source_id`、UUID `profile_version_id`、discriminated `entry` 和可選 UUID `request_key`。UI 每次發送 key。 |
| `entry.adapter_type = web` | `url` 最多 2048 字元。表單將允許的 origin 與 operator 輸入的 document path 組合。FastAPI 核對 URL 和 Source policy，Core 在擷取或 redirect 時再執行存取規則。 |
| `entry.adapter_type = csv` | `dataset_id` 和 inline `content`。上限為 1 MiB UTF-8，禁止 NUL。 |
| GET `/api/v1/collection-jobs/{job_id}` | 回傳實際 status、Lineage、timestamps、counts 及執行欄位。 |
| GET `/api/v1/collection-jobs/{job_id}/events` | 按保存的 sequence 回傳 execution events。 |

首次成功為 HTTP 201 和 durable pending Job。Backend 在交易內保存 Job、固定配置 hash、input hash 和 dispatch intent。相同 Source、key、Profile Version 及 input 重播回 HTTP 200 和現有 Job DTO，重用 key 而輸入或版本不同回 409 `job_request_conflict`。Replay lookup 早於新寫入的 eligibility gates。Draft 或 Retired 回 409，Profile 已核准但 Source access 非 approved 回 403。若兩個條件同時不符，backend 先檢查 Profile。未授權 origin／dataset 回 403，錯誤 request shape 回 422。

提交期間以 request ref 防重入。5xx、network、timeout 或不可讀回應會保留原始請求供 **Retry submission**。Tab session storage 只保留 input fingerprint 與 key，operator 可在同一 tab 重新輸入相同內容後恢復該 key。確定拒絕或確認 Job 後清理 key。不同版本、Source 或 input 具有不同 fingerprint；恢復已清理的表單後再提交是新的 intent。Browser tab、storage 和 secure context 是跨頁恢復邊界。Backend 仍掌握 Source authorization、Profile eligibility 和 Job 去重。
