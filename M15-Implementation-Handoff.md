# M15 Job Operations & Diagnostics 實作交接

## 審查版本

| 項目 | 版本 |
| --- | --- |
| M14 起點 | `b7cc87d2305c57cd8e5e523efa4ac5f21182de17`。本機工作樹乾淨，GitHub Compare 及 Git remote ref 均核對一致。 |
| M15 實作提交 | `c6ddd3244d525d0869344c6a734669a401986f0a`。交接文件另以 docs-only 提交保存，完整交付版本見分支 HEAD。 |
| 交付分支 | [feature/M15-job-operations-diagnostics](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M15-job-operations-diagnostics) |
| 設計與畫面 | [設計決策](docs/evaluation/M15-Job-Operations-Design-Decisions.md) · [截圖索引](docs/evaluation/M15-screenshots/README.md) |

## 稽核與設計

稽核涵蓋 AGENTS、PRODUCT、DESIGN、M3 執行契約、M4-E 提交契約、M4 Closure、M10 Reliability Evaluation、M11–M14 決策、現有路由、Playwright，以及 Job、retry、dispatcher 和 results persistence。可用操作為讀取 Job、Events、Source、Profile 和結果，以及建立或重播一個收集 Job。調度和 lease 由既有服務管理，前端採用持久化資料和唯讀狀態更新。正式 UI 沒有全域基礎設施量測值。

選用 **Operations Ledger + Contextual Diagnostic Detail**。Exception-first 要用多個狀態切片才能同時保留一般 Jobs，Timeline-first 需要跨 Job 事件索引。清冊使用目前 API 的分頁及狀態，詳情使用錯誤位置及結果連結支援例外排查。決策文件附三種低保真結構及取捨。

沿用 vendored UI Slop v1.7（`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`）及 Cobalt／Slate。Structural Direction 將個別 Job 放在清冊主列，Information Relationships 把同一 Job 的狀態、處理結果和 Evidence 連在一起。標記、數量、事件描述和技術披露各有自己的呈現方式。Reactive Surfaces 以狀態改變帶出正確的 Job 結果。Task Continuity 保存深層連結及回程位置。試驗先使用顯示資料，再用真實 API 檢查資料關係。

## 實作行為

| 區域 | 實作 |
| --- | --- |
| Job Ledger | Source 名稱、Job 短 ID、固定 Profile 版本、狀態、接受／無效／重複數量、UTC 建立時間、已記錄錯誤及 Inspect Job。Source 和 Profile 只查目前 20 筆所需的唯一 ID，同時最多四個要求，四秒後使用已取得的名稱及短 ID。完整 ID 在 Job 的 Technical metadata。 |
| 篩選、排序和空狀態 | Pending、Running、Succeeded、Partial、Failed 和 All statuses。Oldest／Newest 由 API 排序。20+1 查詢，offset 上限 2147483647。改變排序或篩選即回第一頁。空系統、無匹配、空 offset、讀取失敗、無效 Job ID 和有效 ID 的 404 有各自的顯示與回程。 |
| Outcome 與診斷 | Pending 初次等待與已排程重試分開呈現。Execution attempts 對應 claim 次數，Dispatch attempts 對應 publication 嘗試。顯示最早重試時間、最近確認派送與適用的派送期限。過期 lease 提示查閱 persisted events。終態保留結果及錯誤。 |
| Events 與失敗檢視 | 原順序使用持久化 sequence，保留各事件 UTC、status、attempt 和錯誤附件。舊版 null 欄位及未知 kind 均有顯示。原始 kind／ID 可展開。HTTP、Retry-After 及 broker code 在適用處顯示。排查指引連到事件與固定 Source／Profile。 |
| 自動與手動讀取 | Pending／Running 可見時每輪完成後等待三秒，頁面隱藏或進入終態時停止排程。Refresh job 重新 GET 當前內容。暫時失敗保留上次成功的 Job 與 Events，顯示資料新鮮度提示，待可見頁再次讀取。 |
| Results／Evidence／Quarantine | 使用 Job 範圍的實際 Record 預覽和既有 Data Explorer、CSV／JSON export。Partial 可查看已發布 Records。逐頁 Evidence capture、Record 直接 Evidence 與 Quarantine 的 Evidence 關聯各自保留。Quarantine 使用 10+1 分頁、實際來源位置、欄位、問題 code／訊息及保存時間。去重計數與拒絕條目分列。Record Inspector 繼續提供 Article 關聯。 |
| Web 提交 | Guided 及從 Source／Profile 進入的兩條路徑。審閱內容來自所選 Source、已核准固定版本、文件路徑或搜尋字詞、核准 origin。適用時可展開 Profile 分頁及擷取規則。Source／Profile 不符合資格時提供原因。 |
| CSV 提交 | 核准 dataset ID、inline UTF-8 CSV、表頭提示、1 MiB 限制、NUL 檢查與 UTF-8 byte 數量審閱。透過既有單一 Job API 寫入。 |
| UUID 與未確認提交 | 201 建立、200 相同意圖重播、409 衝突。防雙擊。5xx、連線失敗、逾時和不可讀成功回應保留同一個 body 與 UUID。SPA 導覽後可重送記憶體中的原始提交。同 tab 重載後只保留 fingerprint 與 UUID，輸入須一致才會重送。確認或明確拒絕後解除該意圖。 |
| URL／History／Focus | Ledger 保有 `status`、`order`、`offset`，Job 的 preview offset 可返回，所有已有路徑可直接開啟。ContextLink 和 ReturnLink 使用同一組結果導覽機制。深層連結帶 Request 來源時以實際親子關係核對。返回項目以 session 中的歷史位置恢復焦點與捲動。 |

## 實際驗證

| 測試 | 證據 | 結果 |
| --- | --- | --- |
| TypeScript 及 production build | `npm.cmd run build` 執行 `tsc --noEmit` 及 Vite production build。 | PASS |
| Playwright 測試替身及 M10–M14 前端回歸 | Chrome 完整 Playwright 149 項。包括所有狀態及排序、URL 邊界、故障／重送、未知與歷史事件、可見性與終態、Records／Evidence／Quarantine、鍵盤、觸控與 axe。四個最終定向檢查另驗證捲動位置、縮放及表單。 | PASS |
| Normal | 專用 PostgreSQL migration 完成後立即 GET Jobs，0 筆。Chrome 開啟空清冊並走到原有 Source／Profile 設定入口。 | PASS |
| Synthetic Demo | 唯讀驗證 Fixture Listings、Influencer Advertising and Sponsorship、Market News and Economic Updates。從 Request 開 Child Job 和 Events，到 Evidence 再回 Job、Records、Record Inspector，再回 Job 與 Request。記錄焦點還原。現有 Demo 服務和儲存保留。 | PASS |
| 真實 Web／CSV 與 provenance | 隔離 Core 確認 HTML Succeeded、CSV Partial、核准固定 Profile、持久化 payload、瀏覽器 Evidence 及 Quarantine 的資料。M6 為 3 個 capture，M7 搜尋為 5 個 capture、3 個直接 Record 結果。 | PASS |
| 真實失敗與重試 | 受控空搜尋 Job `0ef0a186-afc2-4879-af14-10f3a64256d7` 進入 Failed、0 筆接受。HTTP 429 Job `8c4ad1fb-d1dc-43de-beca-39f0e0e4b093` 保存 2 次 RETRY_SCHEDULED、3 次 CLAIMED，終態 Partial，仍有已接受紀錄。 | PASS |
| 真實 Redis／PostgreSQL 恢復 | 專用 Redis 停止時，Job `5c1d41e1-1e1d-49ad-8a06-3a6cafa2be1d` 保有 Pending、0 executions、已記錄 DISPATCH_FAILED 和 broker code。重啟後 2 次派送、1 次執行達 Partial。專用 PostgreSQL 停止時提交回 503，復原以同 body、UUID 得到 Job `6a7517c7-d593-4aff-9acb-54c11208f59d` 並確認 201，再重播 200。另重新啟動隔離 DB／API 並比對相同結果和 Evidence bytes。 | PASS |
| 瀏覽器與可及性 | 1440、900、768、390、320 px；Chrome Appearance 原生 200% 使用實際 720 CSS px 回流。Light、Dark、System 及 reduced motion。axe WCAG A／AA、可見焦點、鍵盤與觸控驗證。 | PASS |
| 實體螢幕閱讀器、重新啟動 Demo Launcher、Worker SIGKILL | 本次使用 axe 及原生語意、已運作的 Demo、實際重試和隔離 Redis/DB 故障。Worker 強制中止與全新 Launcher 啟動維持 M10 歷史證據。 | NOT RUN |

真實整合最終共通過 12 個不同測試，分別為主要重跑 8 個、Web／CSV 定向重跑 2 個、以及 Normal 和既有 Demo 各 1 個。主要整合執行中 Normal／Demo 因環境旗標跳過，兩者在指定環境獨立通過。首輪的舊版選擇器、查詢參數及 Windows CRLF fixture hash 差異已在後續測試校正。HTML Evidence hash 接受同一已提交 fixture 的 LF 或 CRLF bytes。CSV hash 依實際提交或 fixture bytes 驗證。

### 操作與畫面審查

- Pass A 檢查清冊、手機上 Job Detail 和表單。發現欄首的空白操作欄和資料列不同寬，窄版 Record 預覽仍需橫向捲動，部分 link 的可見文字與無障礙名稱不匹配。
- Fix Batch 固定操作欄對齊、將窄版篩選改成緊湊兩欄、將 Record 預覽改為可讀取證據連結的資料列，並修正指向同一 Job／Record／Evidence 的連結名稱。原生縮放改用物理 viewport 截圖，避免訪頁測試工具裁切 200% 畫面。
- Pass B 重看桌面、320／390 px、200%、失敗、重試、Quarantine 與提交畫面。AI Fingerprint Gate 以清冊、實際 dispatch／execution 欄位及序列化事件作為主要操作幾何。Evidence Gate 以 axe、瀏覽器行為、實際持久化 API 和返回測試作為證據。Taste Gate 以短 Job 身份、例外位置、分隔線和結果入口檢視可掃讀性。測試替身的未匹配可選 metadata GET 可出現 proxy 訊息，對應到短 ID fallback；真實測試中的暫時錯誤對應故障注入。

### 重現方式

- Mocked suite 在 `frontend/` 設 `PLAYWRIGHT_CHANNEL=chrome`，執行 `npm.cmd test`。用 `M15_CAPTURE_DIR=../docs/evaluation/M15-screenshots` 保存截圖。
- 真實測試使用 `collection-m3-test-m15-job-qa`、隔離的 PostgreSQL／Redis／Evidence 儲存及受控 HTTP fixture。Compose 使用 `compose.yaml`、`compose.fixture.yaml`、`backend/experiments/m10.compose.yaml` 及兩個既有 Windows subnet overlay。API loopback 綁定 `18175`，PostgreSQL `55545`，Redis `16445`。執行既有 Alembic migrations 後使用 `M4_REAL_API=1`、`API_PROXY_TARGET=http://127.0.0.1:18175`、`LOCAL_PROFILE_APPROVAL=1`。測試檔為 `core-workflow.integration.ts`、`jobs.integration.ts`、`results.integration.ts`，使用一個 worker 避免故障注入時干擾其他測試。服務重啟測試需要 `M4E_COMPOSE_PROJECT`／`M4D_COMPOSE_PROJECT` 指向該專案及 `M4_COMPOSE_OVERLAYS`。
- 空清冊以 `M15_EMPTY_NORMAL=1` 選擇 fresh Normal 測試。三組預設以 `M15_DEMO_READ=1`、`PLATFORM_SYNTHETIC_DEMO=1` 及既有隔離 Demo `API_PROXY_TARGET` 執行 jobs integration 中的 read-only 測試。

## 變更檔案

| 範圍 | 檔案 |
| --- | --- |
| Ledger、診斷、提交 | `frontend/src/features/collection-jobs/{JobList,JobDetail,JobCreate,GuidedPicker,presentation}.tsx`、`api.ts`、`jobContext.ts`、`submission.ts`、`useJobSubmission.ts`、`jobs.css` |
| 結果與 Request 導覽 | `frontend/src/features/results/{QuarantinePage,RecordsExplorer,presentation,resultNavigation}.tsx`、`results.css`、`frontend/src/features/topic-collections/Requests.tsx` |
| 共用基礎 | `frontend/src/lib/useResource.ts`、`frontend/src/styles/console.css` |
| 驗證 | `frontend/tests/{jobs,job-create,dashboard,results}.spec.ts`、`{jobs,core-workflow,results}.integration.ts`、`m15Capture.ts` |
| 審查附件 | `docs/evaluation/M15-Job-Operations-Design-Decisions.md`、`docs/evaluation/M15-screenshots/`、本交接 |

## 已知限制及驗收

Setup scope 依實際 API。Offset pagination 在新增 Job 或狀態異動時可能改變頁面成員。Job DTO 沒有 Request ID 或獨立的 retry-exhaustion flag。介面根據已知導覽關係顯示 parent Request，並透過終態、已記錄錯誤及實際 claims 呈現重試結果。同 tab 重載後，若無法重新輸入原始資料，需檢查 Jobs 及依原始意圖在受控環境協調。CSV 原文只在開啟的文件記憶體中保存。硬體效能和實體螢幕閱讀器測試 NOT RUN。

| Gate | 結果 |
| --- | --- |
| A 範圍與操作界線 | PASS |
| B Job Ledger | PASS |
| C 派送、執行、重試、lease 與 Events | PASS |
| D 失敗與結果檢視 | PASS |
| E Web／CSV 及未確認寫入 | PASS |
| F Task Continuity | PASS |
| G M10–M14 產品回歸 | PARTIAL。全部前端回歸與既有 Synthetic Demo 通過。Launcher cold start NOT RUN。 |
| H 可及性與 responsive | PASS，實體螢幕閱讀器 NOT RUN。 |
| I 驗證與交接 | PASS，提供程式碼、測試、兩輪畫面及 commit。 |

**建議 GO，進入 M15 獨立審閱。** 後續跨里程碑整合及展示準備屬 M16，等待獨立審閱和批准。
