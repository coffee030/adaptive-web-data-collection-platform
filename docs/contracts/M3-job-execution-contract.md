# M3 Job Execution Contract

沿用 `/api/v1/collection-jobs`，request 及首次 201／idempotent replay 200 保持相容。201 確認 Job 及 dispatch intent 已寫入 PostgreSQL。Client 用 `GET /api/v1/collection-jobs/{job_id}` 讀狀態，亦可用清單的 `status` 參數篩選。原有 state enum 維持 pending、running、succeeded、partial、failed。

| 新增 Job 欄位 | 意義 |
| --- | --- |
| `execution_attempt` | 已 claim 次數，從 0 起算。running 時是當前 attempt 的 fencing generation |
| `lease_expires_at` | Running lease 的 UTC 期限。過期即待 recovery |
| `next_attempt_at` | execution retry 的 UTC 最早時間，其他情況為 null |
| `dispatch_due_at` | pending Job 的首次／下一次派送時間，其他情況為 null |
| `last_dispatched_at` | 最後一次確認 publication 的時間 |
| `dispatch_attempts` | 已提交的 publish 嘗試總數 |
| `dispatch_error_code` | 尚未清除的 broker error，例如 `broker_unavailable` |

`pending → running → succeeded / partial / failed`。在可重試失敗或 lease recovery 時，`running → pending`，保留原輸入並清空本次 `started_at`。再次 claim 產生新 `started_at`，舊開始時間可從 events 讀取。終態保留 counts 和 error，釋放 lease 並清除暫存輸入。

Events API 保留既有 status 和序列，新增 `kind` 和 `execution_attempt`。事件包括 `JOB_CREATED`、`DISPATCHED`、`DISPATCH_FAILED`、`CLAIMED`、`RETRY_SCHEDULED`、`WORKER_LOST`、`RECOVERY_REQUESTED` 及終態。M2 歷史事件的兩個欄位為 null。`CollectionError` 新增可為 null 的 `retry_after_seconds`，原有錯誤欄位保留。

| 情況 | 執行政策 |
| --- | --- |
| Network transport、timeout、暫時性 DB 連線／pool 錯誤 | 10 秒、20 秒，最多三次 claim |
| HTTP 429 | 30 秒、60 秒，尊重較晚的有效 Retry-After |
| HTTP 5xx，包括未取得 robots policy | 10 秒、20 秒，尊重較晚的有效 Retry-After |
| Lease expiry | 最多三次 claim，尚有額度時等 5 秒 |
| HTTP 401／403、明確 challenge、無授權、robots deny、其他 HTTP 4xx | 終態失敗 |
| Retired／invalid Profile、內容及驗證錯誤、Evidence error、非暫時性 SQL failure | 原有 failed／partial 結果 |

`Retry-After` 接受 delta-seconds 或帶時區 HTTP date，無效值使用固定 backoff。超過 300 秒時結束 Job。每次 collection attempt 最多 1 次 robots request 及 3 次同 origin document requests，每個 request 最多嘗試一次。整個 Job 上限為 12 次受控 HTTP requests。Preview 和 Validation 各有其獨立既有請求上限。停止 DB 時，若 task 無法 claim，pending Job 會在派送期限後重派。已 claim 的 Job 則依 lease 復原。Celery task 不做 retry 或 ETA 排程。

CLI 繼續接受 Job UUID，重用相同 claim／lease／重試政策。成功或 partial 回傳 exit 0，其餘回傳 exit 1；有排程的 retry 可用 API 查詢。Dispatcher 運行時可能先取得同一 Job。
