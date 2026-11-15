# M7 Controlled Website Collection

## 操作流程

1. 在 **Sources → Create source** 登記 `https://` origin、可核對的許可參考，以及適用的路徑前綴。使用標準 HTTPS port 443，由小寫 DNS 名稱組成的 origin。`allowed_paths` 以 origin 作鍵，`/catalog` 涵蓋該路徑及其子路徑。`/catalogue` 屬於另一個路徑。
2. 檢查 access policy，然後選擇 **Authorize Source access**。可信本機 UI 沿用 `LOCAL_PROFILE_APPROVAL=1`。直接 REST 操作沿用 `PATCH /api/v1/sources/{source_id}/authorization`。
3. 在 Profile Draft 選擇 **Keyword search and detail pages**。選取已登記的 origin，輸入搜尋 path、query parameter、結果項目與詳情連結 selector。詳情頁使用既有 item selector、fields、型別及 identity field。
4. 用樣本關鍵字 **Preview** 和 **Validate sample**。兩種操作各取一個搜尋頁，檢查 next link，並擷取第一個詳情結果。以通過且符合目前設定 hash 的報告核准 Profile Version。
5. 在 **New Collection Job** 選擇核准版本並輸入關鍵字。完成後在 **Capture evidence** 檢查 Search results 和 Detail 頁，在 **Data Explorer** 追查各筆紀錄所屬的 Evidence。

## REST 設定

在既有 HTML `configuration` 加入 `search`。`selector_type` 同時管控搜尋 selectors。每個匹配的結果項目需恰好含有一個符合 detail-link selector 的 `<a href>`。搜尋 path 不含 query 或 fragment。`keyword_parameter` 為固定 query 名稱，執行時以 UTF-8 percent encoding 加入關鍵字。

```json
{
  "origin": "https://example.com",
  "path": "/search",
  "keyword_parameter": "q",
  "result_item_selector": ".result",
  "detail_link_selector": "a.item",
  "pagination": {"next_link_selector": "a.next", "max_pages": 2},
  "max_detail_pages": 4,
  "max_requests": 12
}
```

Preview／Validate 的 request body 及 Job request 的 `entry` 支援 `{"adapter_type":"web","keyword":"C++ & 茶"}`。可用關鍵字為 1–128 個可列印字元。公開 HTTPS Job、Preview 和 Validate 需使用已配置搜尋的版本與 keyword entry。舊有受控 HTTP 的 `url`、舊有 CSV entry 和未設定 `search` 的 Profile hash 格式繼續有效。

| 控制 | 預設 | 允許範圍 |
| --- | --- | --- |
| Search pages | 未配置分頁時為 1 | `pagination.max_pages` 1–5 |
| Unique detail links | 5 | `max_detail_pages` 1–10 |
| Outbound requests per attempt | 12 | `max_requests` 3–20，包含 robots 和 redirects |
| Redirects per document | 2 | `max_redirects` 0–2 |
| Response bytes | 1,048,576 | `max_body_bytes` 512,000–1,048,576 |
| DNS + transfer time per request | 2 秒 | `timeout_seconds` 1–2 秒 |
| Fetch and traversal time per attempt | 45 秒 | `max_seconds` 5–45 秒 |
| Execution attempts | 3 | `max_attempts` 1–3，包含 worker lease 復原 |
| Minimum time between response completion and next request | 1 秒 | Source 的 `min_request_interval_ms` 1,000–10,000，robots 可拉長 |
| Concurrent M7 requests per origin | 1 | Redis 固定互斥 |

Worker hard limit 為 60 秒，PostgreSQL lease 為 90 秒。Retry 在既有 PostgreSQL／Celery 模型重新由第一個搜尋頁執行。較長的 `Retry-After` 會寫入共享 Redis 冷卻期。若延遲超過 Job 自動重試所容許的 300 秒，該 attempt 會以可讀錯誤結束。

## 權限及結果

- 每個 HTTP request 須持有 Source 授權與共享 origin 鎖。搜尋、next link、detail link、redirect 各自驗證同源與路徑。取得 robots 時只對精確 `/robots.txt` 豁免路徑前綴。公網 DNS 的每個解析結果都須合資格，HTTPS transfer 固定在核准 IP，並驗證 TLS hostname 及實際 peer。公開流量禁用環境代理。
- `/robots.txt` 200 須為 UTF-8 純文字，404／410 表示沒有檔案。支援同一 UA 群組、最長路徑、`*`、`$`、`Crawl-delay` 和 `Request-rate`。明確阻擋、其他非成功狀態、redirect 或無法在現有限制內執行的 timing 規則會停止收集。Legacy M6 HTTP fixture 的 robots 與請求模式保留。
- Search page 屬於 `capture_kind=search`，詳情屬於 `detail`。既有輸入預設 `input`。`page_number` 表示本次發布的捕捉順序。舊 Evidence 單物件 endpoint 繼續回傳第一頁，`/evidence-pages` 回傳依捕捉順序排列的列表。
- 空結果會保留搜尋 Evidence 並以 `empty_search_results` 結束。下一頁循環、部分詳情失敗或達上限可回傳 `partial`。至少一筆通過欄位驗證才會成為 `partial`。單筆無效欄位由既有 Quarantine 保存。403 和已識別的 challenge 會中止，429 與暫時性連線／HTTP 問題依既有政策重試。
- 同一次 attempt 內依正規化後的詳情 URL 去除重複連結，再由既有 Generic Record 驗證和 identity 處理重複紀錄。Job 終態只發布一組 attempt 結果。檔案儲存與 PostgreSQL 各自提交，失效 attempt 可留下未被引用的 Evidence 檔案。

Public network transport uses libcurl DNS pinning. [libcurl CURLOPT_RESOLVE](https://curl.se/libcurl/c/CURLOPT_RESOLVE.html)

Robots rule matching follows the applicable portions of the Robots Exclusion Protocol. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)
