# M7 Implementation Handoff Report

2026-11-16（香港時間）

## A. Repository Baseline

- 本機起點為 `feature/M6-multi-page-evidence` 的 `2b95b26ef55f47702dfdc1d257c2642f595bab09`。GitHub [Draft PR #1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1) 開啟且尚未合併。GitHub `main` 在 `2f880f9ae1e30fa3fff7e11261194873b8ccd2de`。
- 遠端 M6 起點為 `96e7a5c1bc2ae9f3a849641327de6f1ef2167053`。它是已驗收 `654134983654aaeabb63c4de7d36d4f3e5784c72` 的直系後繼，差異為 M6 handoff 文件。比對遠端 287 個 Git blobs 和本機 290 個 tracked blobs，工作程式碼、schema、前端及測試一致。共有 9 份 README／指引／文件的 blob 不同，本機另外有 3 份歷史或協作文件。
- 已閱讀 repo instructions、專案 skills、M2／M3 架構、Job／REST 合約、M6 handoff 與分頁合約。沿用 Source authorization、Profile hash pin、Scrapling HTML selectors、Generic Record ingestion、Quarantine、Evidence sidecar、PostgreSQL attempt fencing、Dispatcher 和 Celery。
- M6 的公開目的地檢查、共享 pacing 和 capture 類型仍有缺口。現有 Job payload 和 Profile 設定採 JSONB，足以存放 keyword 和搜尋策略。只有查詢用 Evidence 類型需要 DDL。

## B. Completed Tasks

| 工作 | 實作和驗證 |
| --- | --- |
| M7.0 Audit and baseline | 比對本機及遠端 M6，執行未修改的本機回歸。 |
| M7.1 Approved HTTPS | 新增明確 origin／path 授權、DNS pinning、TLS peer check 及 robots 政策。 |
| M7.2 Keyword configuration | 將 endpoint、query parameter、selectors 及上限納入 Profile hash，以新版本及樣本驗證核准。 |
| M7.3 Search pagination | 重用 M6 next-link 檢查、URL 正規化及 visited tracking。 |
| M7.4 Detail and Evidence | 以相同 ingestion 驗證詳情，保留 search／detail 捕捉、Quarantine 和各筆 Record 的來源。 |
| M7.5 Per-origin rate | Redis Lua 跨 API／Worker／Job／Source 登記共用 origin 鎖和間隔。 |
| M7.6 Recovery | 重用 claim、lease、retry、dispatch 及 SQL 發布流程，加入 M7 retry／worker-loss 實測。 |
| M7.7 Operator controls | 在既有 Sources、Profiles、Collection Jobs、Data Explorer 加入輸入及 Evidence 類型。 |

## C. Architecture Changes

- 已授權 Source → 核准 Profile → Job 固定版本與 hash → robots → Keyword Search 及 M6 next link → 授權詳情 → Generic Record 驗證／去重 → Evidence／Quarantine → attempt fencing 和終態發布。
- 舊 Job／Preview／Validate body 仍能接受受控 Web `url` 或 CSV。搜尋版以 `{ "adapter_type": "web", "keyword": "…" }` 提交。搜尋頁數與詳情數分別計數，重複 URL 在單次 attempt 正規化去重。Profile 省略 Search 設定時沿用既有 hash 演算法及序列化形式。
- Alembic `0008_evidence_capture_kind.py` 以 `input` 為既有資料的預設，使用 constraint 限定 `input`, `search`, `detail`。Evidence ID、頁次、run、FK 和 sidecar hash 保留。舊 single-Evidence endpoint 回傳第一頁，多頁 endpoint 依 `page_number` 排序。
- 每一 origin 只准一個 request。持有者以 token 結束鎖，Redis 原子寫入共享 pacing deadline。釋放後之最短間隔採 Source／robots 規則的較嚴值，429 另保存 `Retry-After`。Redis 無法確認時，request fail closed。既有 PostgreSQL retry／lease 處理後續嘗試。 [M7 REST and operator contract](../contracts/M7-controlled-website-collection.md)

## D. Security Review

- 公開收集限 HTTPS 的小寫 DNS hostname、標準 443、已登記 origin 及適用 path。運行前檢查 Source 和 Profile 授權，每個 outbound request 再核對 Source 授權。拒絕跨源 next／detail／redirect、使用者資訊、異常 URL 編碼和歧義路徑。
- 每個 HTTPS request 重新驗證 DNS 的所有答案。拒絕 loopback、私網、link-local、multicast、轉接 IPv6、已列入的特殊公網／metadata 位址和混合安全／不安全答案。使用 curl 新 handle pin 至合資格 IP，驗證 SNI 所用 hostname 的 TLS 憑證，再核對實際 peer。停止自動 redirects，禁用環境代理。 [libcurl CURLOPT_RESOLVE](https://curl.se/libcurl/c/CURLOPT_RESOLVE.html)
- robots 用公開產品 UA、最長匹配、群組、通配符及 timing 規則。明確拒絕、challenge、非可解析政策或超過可支援的 robots 間隔時停止。逾時、429、5xx、request budget、body limit 和 redirect limit 均有結構化 error。請求錯誤使用固定訊息，完整 discovered URL 在 Evidence 正常授權範圍保留。 [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)
- 每 attempt 搜尋 1–5 頁、最多 10 個唯一詳情連結、最多 20 個 HTTP 請求、每頁最多 2 redirects、每 response 最多 1 MiB、每次 HTTPS DNS 和 transfer 合計最多 2 秒、收集 budget 45 秒、最多 3 次 execution attempts。Celery hard limit 60 秒和 PostgreSQL lease 90 秒沿用原值。Keyword 的 Preview／Validate 在前端等待最多 50 秒，以容納新流程的 robots pacing 和網絡上限。

## E. Test Results

| 實際命令 | 結果 |
| --- | --- |
| `.\.venv\Scripts\python.exe -m pytest -q -rs --tb=short backend/tests`（M6 起點，允許 localhost fixtures） | 148 passed、52 skipped。Skipped 為當時未啟動 PostgreSQL／Redis／Compose。 |
| `.\.venv\Scripts\python.exe -m pytest -q --tb=short backend/tests/m1/test_m7_search.py -k 'robots or timeout'` | 6 passed、45 deselected。 |
| `.\.venv\Scripts\python.exe -m pytest -q -s --tb=short backend/tests/m2/test_m3_compose.py -k m7_recovers`（修正後） | 1 passed、4 deselected in 32.85s。 |
| `.\.venv\Scripts\python.exe -m ruff check backend` 及 `-m ruff format --check backend` | 全數通過。 |
| `npm.cmd test`（`frontend/`，Chrome，port 5195） | 86 passed。 |
| `npm.cmd run typecheck` 及 `npm.cmd run build`（`frontend/`） | 皆通過。 |
| `npm.cmd test -- tests/core-workflow.integration.ts --workers=1 -g 'M7 browser'`（Chrome，`M4_REAL_API=1`、`LOCAL_PROFILE_APPROVAL=1`） | 1 passed、0 failed。驗證畫面 1,440／390 px 無水平溢出，axe 無違規。 |
| `npm.cmd test -- tests/core-workflow.integration.ts --workers=1`（Chrome，`M4_REAL_API=1`、`LOCAL_PROFILE_APPROVAL=1`，API port 18007） | 5 passed in 37.4s，含 M7、M6、單頁 HTML、CSV 及授權拒絕。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/Test-Launcher.ps1` | 23/23 passed。 |
| `.\.venv\Scripts\python.exe .local/m7-verify/live_https.py` | 兩次真實 HTTPS 執行成功，每次一筆 Record 和兩份 Evidence。 |
| `.\.venv\Scripts\python.exe -m pytest -q -rs -s --tb=short --junitxml=.local/m7-verify/backend-regression-final.xml backend/tests`（`fe779b1`） | **256 passed in 420.12s**，exit 0。JUnit 共 256 項、0 failed、0 errors、0 skipped。日誌位於 `.local/m7-verify/backend-regression-final.log`。 |

完整測試使用 `M2_TEST_DATABASE_URL` 指向 PostgreSQL 17 loopback `55437`，`M3_TEST_BROKER_URL=redis://127.0.0.1:16387/1`，`M2_TEST_COMPOSE_PROJECT` 及 `M3_TEST_COMPOSE_PROJECT` 皆為 `collection-m3-test-m7-verify`，`M3_TEST_COMPOSE_API_URL=http://127.0.0.1:18007`。Compose 參數以該 project 和 `compose.yaml`、`compose.fixture.yaml` 為基礎，另載入 `-f .local/m7-verify/compose.image.yaml -f scripts/windows/compose.subnet.yaml -f scripts/windows/compose.fixture-subnet.yaml`。由空庫升至 `0008`，以 `alembic current --check-heads` 確認。舊資料測試透過 `0006 → head` 與 `alembic check` 驗證既有 Record／Quarantine／Evidence IDs、bytes 和新欄位預設。

第一次回歸為 249 passed、1 failed in 387.33s。測試 shell 的全域 `CELERY_BROKER_URL` 令既有 outage test 使用正在運行的 broker，移除該覆寫後通過。加入 M7 worker-loss coverage 後為 255 passed、1 failed in 449.11s。該次實際 worker kill 發現 Dispatcher 在讀 retry bound 時重跑了 fixture host 驗證。修正後 Dispatcher 只讀取已核准版本內的 bound，worker 繼續核對目的地。Focused recovery 已重測，完整回歸由修正 commit 執行。

## F. Actual End-to-End Verification

- 以專用 image `collection-backend:m7-verify` 建立 Docker Compose，PostgreSQL、Redis、API、Celery、Dispatcher 和 fixture 各為既有服務。`docker compose @m7ComposeArgs config --quiet`、`up -d --wait postgres redis`、`build api`、`run --rm --no-deps api python -m alembic upgrade head`、`run --rm --no-deps api python -m alembic current --check-heads`、`up -d --wait --no-build` 成功。API health 回 `{"status":"ok"}`。首次選用的 subnet 跟 M6 隔離網段重疊，切換至 `10.249.115.0/24` 及 `10.249.116.0/24`。API 啟動時一次空回覆，稍後健康檢查成功。
- 實際兩個 prefork worker 同時執行同源的 Cards/CSS 和 Catalog/XPath Jobs。最終測試 Jobs `726d44ff-8fa0-43ae-aab3-74f6e72a9696` 和 `8d7cb697-c1ee-415a-94d8-fe33b5a574d9` 各有五個 Evidence、兩筆通過紀錄及一筆 Quarantine。兩個 layout 共發出 12 次 request，最短完成至開始間隔 1.004 秒。已核對 Capture、Record 和 Quarantine references。
- Chrome Job `e7e22be8-c80e-4357-b58d-0b0a3f10d2f0` 完成來源登記及核准、Profile draft、Preview、Validate、Approve、keyword 提交，再從 Job 頁開啟 Detail Evidence。以 `C++ & 茶#/` 搜尋，取得兩個 search capture、三個 detail capture、三筆正確關聯的 Record。瀏覽器樣本用 title-only schema，兩種 backend fixtures 另用整數欄位檢查 Quarantine。截圖位於本機忽略目錄 `.local/m7-verify/browser/`。
- 公開 HTTPS source 為提供明確 scraping practice permission 的 **Catalog108**。批准 `/jobs` path policy，遵守其 `robots.txt`，以 `DevRel Advocate` 測一個搜尋結果和一個詳情。第二次實測 Job `12312afe-367d-4d92-ac2a-cd178995bd39` 為 `succeeded`，attempt 1，1 筆有效 Record、0 Quarantine，search 和 detail 都為 HTTP 200。Record `cfbf9dc6-da40-55a9-9400-836c6d129209` 指向 detail Evidence `f60f9461-3733-4df8-9db8-2fd6f28aaffc`。 [Catalog108 practice sandbox](https://practice.scrapingcentral.com/)
- Catalog108 設定使用 `/jobs/search`、query parameter `q`、XPath `(//tbody/tr)[1]` 和 `./td[1]/a`，詳情 selector 為 `//article[@class="job-detail"]`，title 取 `.//h1`。Source pacing 為 1,500 ms，最多一個 detail 及四個 requests。腳本透過實際 FastAPI 建立 Source 和 Profile、驗證範例、核准並提交 Job。
- 修正後重啟 Compose，確認同一 Catalog108 Job 的 Record 及兩份 Evidence 仍可從 API 取得，API 和 Worker 容器內的兩份 raw files 皆符合各自的 SHA-256。
- 修正後的 focused Job `a50b49c3-e039-4643-9181-a58ebdb89c0c` 和完整回歸 Job `053f514e-3b4c-4081-aa7d-ce69d542f5f2` 在等候 Evidence 發布鎖時透過 `SIGKILL` 中斷。測試將隔離 Job 的 lease 設為過期以觸發 Dispatcher。Attempt 2 核對五份 Evidence 和正確 Record links，舊 attempt 無可見結果。重送被判為 `job_not_pending`。Redis、PostgreSQL、API 重啟後 API snapshot 及五份 raw capture SHA-256 相同。M6 回歸 Job `a8aee1c9-726c-44a0-a2d6-9dca13e78751` 另外等待實際的 90 秒 lease。
- 驗收後以 `docker compose @m7ComposeArgs stop` 停止隔離 project。`ps --status running --quiet` 確認沒有運行中容器，PostgreSQL、Redis 和 Evidence named volumes 保留。

## G. Known Limitations

- 靜態 `text/html` 和單一 origin 的範圍。Profile 使用一個 GET keyword query parameter，不會提交登入、POST forms、載入子資源或執行 JavaScript。需要 robots redirects、超過 10 秒間隔或其他 robots 政策格式的 source 會安全停止。
- Preview／Validate 只用第一個搜尋頁和首個詳情結果。完整 link chain 和其他結果在 Job runtime 才檢查。Redis 每 origin 互斥固定為 1，Legacy M6 HTTP fixture 保留原有 runner。分散式 Redis 的完整資料遺失情況未驗證，Compose 測試使用平台現有的 AOF。新 attempt 會重新取頁，因此網站內容改動會改變證據。
- 被取代或中斷的 attempt 可留下未被 SQL 引用的 Evidence 檔案。既有 filesystem／DB 提交邊界仍然適用。沒有跨 Job 的文章 identity 或歷史觀測。
- M8 Category／Topic、Article Identity、Observation History、Manual Refresh、M9 guided flow 和 M10 未進入 M7。沒有瀏覽器生產依賴、公開部署或下游專用邏輯。

## H. Git Information

- 本機與 GitHub M7 分支名均為 `feature/M7-controlled-website-collection`。GitHub 分支從遠端 M6 `96e7a5c1bc2ae9f3a849641327de6f1ef2167053` 建立。
- `4251f892365129f1e4fffb063969e2fdcb4816df` — Collect approved keyword searches and preserve detail evidence。
- `72f00d8ac569f044652885791632c454a4db04d0` — Expose keyword collection in the operator console。
- `4dc96b48d60d641a87dda0254085657db1c11968` — Verify keyword recovery and document the M7 contract。
- `fe779b1a288a3ccbe09780eafde737bea42a1b6f` — Read the pinned retry bound during dispatcher recovery。
- Draft PR URL 待定。GitHub 工具已建立分支，automatic approval review 拒絕將本機程式碼上傳到指定 GitHub repo，原因是沒有在可信對話中確認上傳授權。遠端 M7 目前仍指向 M6。提交範圍限 M7 相關檔案。本機原有隊友文件的修改及 M5 launcher handoff 的刪除均未納入。沒有合併 PR 或修改 `main`。

## I. Acceptance Checklist

| M7 完成條件 | 狀態 | 觀察結果 |
| --- | --- | --- |
| M6 維持功能 | PASS | 完整 backend regression 含既有 M6 pagination 及 worker recovery。 |
| 支援明確核准的公共 HTTPS Source | PASS | Catalog108 真實 Job，另有 allowlist／DNS security 測試。 |
| 關鍵字用 operator 核准鎖定的設定 | PASS | Chrome 核准流程和 pinned hash。 |
| Search result pagination | PASS | Cards、Catalog 及 Chrome 兩頁，另有 loop 和 invalid-link 檢查。 |
| Detail 只經已驗證的目的地擷取 | PASS | HTTPS URL、DNS、redirect、robots、blocked address 測試。 |
| 詳情擷取產生 Generic Records | PASS | 兩種 fixtures 和 Catalog108。 |
| 每筆接受 Record 保有正確 Evidence lineage | PASS | CSS、XPath、Chrome 與公開 HTTPS 關聯核對。 |
| Search 和 detail 都可追查 | PASS | `capture_kind`、API、Evidence Metadata。 |
| 多 Worker 同源 rate control | PASS | 兩個實際 prefork workers、12 次 requests、最短間隔 1.004 秒。 |
| 安全限制及故障恢復均經測試 | PASS | DNS／blocked redirects／robots／403／429／5xx／timeout／Redis／PostgreSQL／worker loss。 |
| 原有 HTML 和 CSV 回歸 | PASS | 既有 M5.5／M6 後端全套及瀏覽器回歸。 |
| 兩組受控 fixtures 端到端通過 | PASS | CSS Cards 與 XPath Catalog。 |
| 實際系統啟動及瀏覽器驗證 | PASS | Compose、FastAPI health、Chrome 在真實 Job 驗證。 |
| 真實 HTTPS 驗證 | PASS | Catalog108 attempt 1。 |
| M8–M10 與應用專用範圍維持隔離 | PASS | 僅上述共用 Core 和 operator integration。 |
| 堆疊 Draft PR 可供獨立審查 | NOT VERIFIED | GitHub 源碼上傳需可信對話授權。 |

## J. Independent Review Recommendation

本機實作與功能驗收已完成，可按本報告與已提交的本機分支審查。GitHub 獨立審查須先確認程式碼發布授權，將上述 commits 上傳至 M7 分支，並開啟以 M6 為基底的 Draft PR。M7 的獨立驗收狀態待審。M8 尚未開始。
