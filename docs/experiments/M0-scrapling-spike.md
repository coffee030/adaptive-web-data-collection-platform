# M0 Scrapling Parser and HTTP Fetcher Spike

實測組合為 CPython 3.12.14、Scrapling 0.5.1 和 `curl_cffi` 0.17.0。使用兩份離線 HTML 及綁定 `127.0.0.1` 的臨時 HTTP server。完整套件和重現方法見 [環境報告](M0-environment-report.md) 和 [README](../../README.md)。

## Parser

| 預期 | 實際觀察 | 結果 |
| --- | --- | --- |
| 兩種布局使用同一 extractor | `cards.html` 以 CSS 選取重複 `article`，`table.html` 以 XPath 選取 `tr`。不同 config 共用同一 `extract()`，各擷取兩筆並比對明確 payload。 | PASS |
| 文字、屬性及相對 URL | HTML nested text 經空白正規化，識別碼和連結從 attribute 讀取。`../items/a1` 和 `/items/c3` 以頁面 URL 解析。Payload link 可保留 `#map`，排程用 URL 另行去 fragment 和驗證。 | PASS |
| 缺失欄位與空結果 | 空白文字及缺少 `href` 是 `None` 並列入 `missing_required`。可選欄位缺失是 `None`。合法 selector 沒匹配時回傳空 list。 | PASS |
| 無效 CSS／XPath 可區分 | 兩者皆拋出 `cssselect.SelectorSyntaxError`。Scrapling 將底層 XPath exception 包裝為同一型別。 | PASS |

`get_all_text()` 的預設 separator 可在 nested text 間插入換行。本 Spike 明確把連續空白合併為一個空格。欄位採首個匹配，XPath 欄位用相對 expression。正式 Profile validation 仍須決定欄位 cardinality、XPath 範圍和樣本異常門檻。Adaptive matching 在本實驗停用。

## HTTP 與 request metadata

| 情境 | 預期 | 實際觀察 |
| --- | --- | --- |
| `200`, `403`, `429`, `500` | 取得 status、headers、raw body、URL | 每種 status 都回傳 `Response`，可讀取 `status`、`headers`、`body`、`url`，且可直接用 CSS 解析。預設及 `retries=2` 均各只送一次。`429` 的 `Retry-After: 60` 原樣回傳，未延遲重試。 |
| `timeout=0.2`，server 延遲 0.8 秒 | 觸發 timeout，請求次數受限 | 拋 `curl_cffi.requests.exceptions.Timeout`，curl code 28。預設 3 次總嘗試（約 2.64 秒），`retries=0`／`1` 都各 1 次（約 0.19–0.22 秒），`retries=2` 共 2 次（約 1.42 秒）。預設 retry delay 約 1 秒。 |
| 預設 headers | 由 server 觀察實際 UA／Referer | 該安裝送出 Windows Chrome 152 User-Agent、`sec-ch-ua` 和 `Referer: https://www.google.com/`。此值是 header，請求只到 loopback。 |
| 只停用 `stealthy_headers` | 量度與預設差異 | Google Referer 消失，Chrome User-Agent 和 `sec-ch-ua` 仍存在。 |
| 只停用 `impersonate` | 量度與預設差異 | 仍收到 browser-like headers 和 Google Referer。自訂 `Referer` 可覆蓋預設。 |
| 兩者停用並提供專案 UA | 識別流量 | 收到 `FYP-Collection-Spike/0.1`、Host、Accept-Encoding。這個請求未送 Referer 或 `sec-ch-ua`。 |
| 預設 `follow_redirects="safe"` | 觀察 loopback redirect | 首次 GET 成功到達測試 server。回應 `302` 後 curl code 7 拒絕內部 IP，target 收到零請求。預設模式容許直接以 loopback 作起點。 |
| `follow_redirects=True` | 量度 redirect 跳數和 final URL | `/redirect` 再到 `/ok`，final URL 和 `200` 正確。歷史項目是 curl_cffi `Response`，用 `status_code` 取得 `302`。`max_redirects=1` 遇到 loop 在兩個 HTTP requests 後拋 curl code 47。 |
| `follow_redirects=False` ＋ fixture gate | 先讀 `Location` 再核准下一跳 | 取得 `302`、原始 URL 和 Location，先驗證後才跟隨同 origin。換 port 的 Location 被拒並只送出原始請求。 |

初次完整測試有一項因誤把 `response.history` 的 HTTP transport 項目當成 Scrapling `Response` 而失敗。修正為 `status_code`，加上 redirect history 預期值後全數通過。UA 版本受鎖定 transport／header data 影響，測試以可核對的行為判斷。

## Source Access Policy 的必要控制

1. 只接受明確核准的 HTTP(S) `scheme + hostname + effective port`，拒絕 credentials、畸形 authority 和危險字元。從已驗證 response URL 解析相對 redirect 和發現的 links。跨 origin、HTTPS downgrade、redirect loop 和 hop budget 要明確處理。
2. HTTP wrapper 關閉 auto-follow，對初始 URL、每個 redirect 及 discovery URL 重新核對來源授權、robots 和 request budget。驗證 DNS 的 A／AAAA，拒絕 loopback、private、link-local、IPv4-mapped IPv6 等不允許地址。連線必須使用已驗證的解析結果，或經受控 egress enforcement，同時保留原本 Host、SNI 和 TLS certificate verification，防止 DNS rebind／TOCTOU。
3. 驗證 wrapper 能阻止環境 proxy 影響實際 egress。0.5.1 建立 `curl_cffi.Session()`，底層預設 `trust_env=True`。實驗以 pytest 的 `NO_PROXY=127.0.0.1` 局限到測試 server。公共網絡的 proxy 行為、DNS pinning、HTTPS certificate 和 response size 限制仍需驗證。
4. 設定固定 project UA、`stealthy_headers=False`、`impersonate=None`、`retries=1`，以及 request timeout 和整體 task deadline。HTTP 403 或明確 block marker 須停止。429 由 Core 解析及限制 `Retry-After`、調節來源冷卻期。Timeout／選定 5xx 由 Core 決定有界重試及持久事件，記錄 status、attempt、時間及安全化診斷。

Fixture gate 只容許 `127.0.0.1` 上當次 server 的 exact origin，對 private、link-local、不同 port、其他 scheme、credentials 和 alternate loopback 表示均先拒絕。未執行這些被拒絕目的地的網絡請求。這一組實驗涵蓋 redirect policy 可行性。Production DNS、robots、egress 防護和 retry engine 仍待實作及測試。[Scrapling HTTP guide](https://scrapling.readthedocs.io/en/latest/fetching/static.html) · [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
