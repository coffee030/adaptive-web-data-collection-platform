# M6 Controlled HTML Pagination

在已授權的 HTML Source 建立 Draft Profile，設定 **Next-link selector** 及 **Maximum HTML pages**，然後 Preview、Validate sample 及 Approve。API 的 HTML `configuration` 可加入以下欄位。

```json
{
  "pagination": {
    "next_link_selector": "a.next",
    "max_pages": 3
  }
}
```

Selector 使用 Profile 的 CSS 或 XPath 類型。每頁可以沒有符合條件的元素，或有一個帶 `href` 的 `<a>`。沒有匹配元素代表已走到最後一頁。頁數上限是 1 至 5，包含起始頁。省略 `pagination` 會執行單頁 HTML 收集，並保留既有 Profile 設定的 SHA-256。CSV 繼續使用 dataset 與 row 的來源位置。Preview 與 Validate 使用提交的單頁樣本，Validate 也檢查樣本的 next-link 形狀與目標。

後端以最終回應 URL 解析相對連結。每個已請求的文件 URL 都會記入本次 attempt 的 visited set，包含 redirect hops。Fragment、空路徑與可等價的 percent encoding 會在判斷重複時正規化。Next link 和 redirect 限同一 origin，並受既有 Source allowlist、robots 及權限檢查約束。M6 受控範圍維持 literal loopback 與 opt-in Compose fixture。每頁最多 1 次 robots 請求及 3 次文件請求（包含 2 次 redirect），每次請求的 timeout 為 2 秒。五頁最多 20 個 HTTP 請求。Celery hard limit 為 60 秒，PostgreSQL lease 為 90 秒。

## Job 結果

| 條件 | 結果 |
| --- | --- |
| 遍歷結束，有有效紀錄，沒有欄位驗證失敗 | `succeeded`，重複紀錄只計數 |
| 有有效紀錄，部分候選驗證失敗或遍歷中止 | `partial`，有遍歷錯誤時保留 `error` |
| 沒有有效紀錄 | `failed`，保留已捕捉的 Evidence／Quarantine 與適用錯誤 |
| 有符合 retry policy 的 transient error 且尚有 attempt | `pending`，依既有 429、5xx、timeout／連線及 `Retry-After` policy 重新由第一頁開始 |

有 next link 但達上限會設定 `page_limit_reached`。重複文件 URL 會設定 `pagination_loop`。無效 next link、selector 或 redirect 會中止遍歷。已取得的失敗 HTTP response 可以保留 Evidence，例如 429 或 503。未取得 response 的 timeout 沒有該頁 Evidence。Record identity 依 Job 去重，首筆通過驗證的紀錄保留。Quarantine 的 HTML item index 在每頁由 1 開始。

同一個 Job 的終態 attempt 在一個 PostgreSQL transaction 發布 Evidence、Records、Quarantine、統計與終態事件。Worker 停止或 lease 過期時，由 Dispatcher 發起受限復原。過期 attempt 或重送訊息無法再次發布已完成 Job。Raw bytes 與 sidecar 先以同一 filesystem 的目錄 rename 發布，之後再核對檔案及 hash 並寫入 SQL。被取代的 retries、強制終止或 SQL rollback 可能留下無 DB 參照的目錄。停用寫入程序後可比對資料庫 Evidence IDs 與 volume 內容。

## API 與資料升級

- `GET /api/v1/collection-jobs/{job_id}/evidence` 保留第一個 Evidence object 或 `null` 的合約。
- `GET /api/v1/collection-jobs/{job_id}/evidence-pages` 依 `page_number` 回傳已提交的 Evidence；有 Job 但未發布 Evidence 時回傳 `[]`。
- `GET /api/v1/evidence/{evidence_id}` 及 Job Evidence 物件包含 `page_number`。Record 和 Quarantine 保留 `evidence_reference` 欄位。Quarantine 依頁次、候選位置及 ID 排序。
- 停止 API、Worker 與 Dispatcher 後，由新版執行 `python -m alembic upgrade head` 並確認 `python -m alembic current --check-heads` 顯示 `0007 (head)`，然後啟動新版。`0007` 將舊 Evidence 指定為第 1 頁，保留 UUID、hash、URL、Profile pin、原始檔及關聯。
- `0007 → 0006` 僅適用於符合舊唯一限制的資料。已有多頁 Evidence 時，PostgreSQL 會在重建舊 constraint 時回滾 downgrade。若需恢復 M5.5，應使用導入多頁設定前的資料庫與 Evidence volume 備份。

## Controlled fixture

使用 `compose.fixture.yaml`，登記已授權 origin `http://collection-fixture:8001`。Draft 選 CSS，item selector 設 `article`，輸出 `title` 使用 `h2`、型別為 string、必填，並選 `title` 作 identity。Next-link 用 `a.next`，頁數上限選 3。樣本及 Job document path 都填 `/pagination/1`。預期 Job 為 `partial`，有 3 頁 Evidence、3 筆有效紀錄、2 筆 Quarantine 及 1 筆 duplicate。兩筆 Quarantine 都是各自頁面的第 2 個 item，分別連往第 2 頁及第 3 頁 Evidence。
