# M13 Data Explorer 實作交接

## 審核基準與交付

- 起始 M12 SHA 為 `432119acc2ec0860d316877577bf0efd4c2db9c1`。建立 M13 前，本機與 GitHub 的 M12 HEAD 一致。
- 最終 M13 實作 SHA 為 `e0e5c48710d2fc8cee01cdd71884d49bcf3c02fa`。後續交接提交包含本檔案及 QA 截圖，完整分支 tip 由 GitHub 或 `git rev-parse feature/M13-evidence-first-data-explorer` 取得。
- 獨立審查分支為 [feature/M13-evidence-first-data-explorer](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M13-evidence-first-data-explorer)。
- API／persistence 審核、關聯圖、三種低保真方案及取捨載於 [M13 設計決策](docs/evaluation/M13-Data-Explorer-Design-Decisions.md)。瀏覽器畫面及來源載於 [21 幅截圖索引](docs/evaluation/M13-screenshots/README.md)。

## 操作與資料

Data Explorer 使用 Record Ledger 和可關閉的 Inspector。全域、Job、Request 各有明確範圍。十筆資料加一筆探測下一頁，Oldest／Newest 依 PostgreSQL 實際保存時間及 ID 排序。改範圍或排序時回第一頁。拒絕衝突及無效的 ID。未知、已刪除、超頁或超範圍的選取有明確回饋。資料狀態由 API 提供，Partial 清冊仍顯示實際發布紀錄。Job Quality 保留有效、無效和重複計數及 Quarantine 入口。

Inspector 在寬版隨選取出現在清冊右側，窄版切到全寬檢查。內容、來源和驗證狀態優先，Capture Evidence 及 Article History 動作跟隨實際關聯。關閉或 Escape 可回到相應列。Record Detail 保留完全獨立網址及完整 JSON，長 hash、ID、來源位置及去重鍵收在 provenance disclosure。Evidence 顯示後端保存的擷取種類、HTTP 狀態、頁次、時間、位置及 SHA-256。Web metadata 位置會去掉帳密、query 和 fragment。直接 Evidence 連結有相關 Job Records 後備，已知 Request 可對照 Job 成員後開啟。Job Capture 的 Search、Detail 與 Input 保持分明。

URL 負責範圍、排序、offset、Record 選取與 Article 的版本、觀測及各自 offset。明確返回連結使用受限的內部路徑，原瀏覽歷史存在時沿原項目返回。App Shell 內的 ScrollRestoration 繼續處理整體捲動。M13 另記錄最多 64 次瀏覽歷史的觸發點及捲動位置，配合 REST 返回後還原。Fields to Display 最多保留 12 個 scope，每 scope 最多 160 個已讀頁面欄名和勾選，工作階段重新載入時重置。Missing、Null、空字串、0 和 false 各有清楚表達。顯示設定和瀏覽歷史不在瀏覽器保存 payload。

Article 最新內容和版本目錄跨收集。Request 導入後，Observation History 限定於該 Request，單筆觀測的 Request 身份按回應驗證。觀測可開原 Record／Evidence／Job／Source／Profile，並選取實際捕獲的 Content Version。版本和觀測可獨立返回。沒有映射的 Record 繼續使用同一檢查流程。

整個 Request 或 Job 的下載仍由既有詳情頁操作，保持 CSV／JSON 格式、檔名、所有保存欄位及錯誤回饋。核對終態、5,000 筆／8 MiB 上限和實際 scope 中的紀錄。清冊欄位及分頁只控制顯示。

## 驗證與接受門檻

| Gate | 狀態 | 實際結果 |
| --- | --- | --- |
| A　API 及資料完整性 | PASS | M8 Article 及 M9 Export 的 PostgreSQL／Redis suite 8 passed。真實 REST 核對 Record ID、Request FK、原 Job、Profile、Evidence、Version。 |
| B　Record Ledger | PASS | 真實 12 筆 Request 以 UI 對照 Oldest／Newest 及 API Record ID。全域及 Job、Request 入口、空頁、混合欄位、無效範圍和 10 + 1 界限有 Edge 覆蓋。 |
| C　Inspector | PASS | Edge 驗證開啟、關閉、Escape、深層連結、失效選取、桌面並排及窄版。Record Detail 仍可獨立載入。 |
| D　Evidence | PASS | 真實 HTML、CSV、Detail Evidence 和 Job Capture，核對 hash、來源和 Profile。含 query／帳密／fragment 的模擬網址在 UI 層去除。 |
| E　Article History | PASS | 獨立 fixture 切為 Revision 2 後，重新收集產生 Content Version 2。原 Request 的觀測仍開啟 Version 1。觀測／版本 offset 和 reload 另以 mock 驗證。Fixture 回到 Revision 1。 |
| F　任務延續 | PASS | 真實 Request → 第 2 頁 → Record → Evidence → 原 Inspector → 原頁 → 下一筆。Article → Version／Observation → Record → Evidence → Back × 2。模擬測試另外驗證精確捲動值、欄位及第二／第三筆、Back／Forward。 |
| G　下載及狀態 | PASS | 控制環境真實下載 Request／Job CSV 與 JSON，內容依 API 逐欄核對。兩個 Partial 子 Job 的 Request 有實際驗證紀錄。另一個 Failed Job 沒有已驗證紀錄。等待和上限錯誤由 UI 及 API 測試覆蓋。 |
| H　響應及可及性 | PASS | Edge 1440、900、768、390、320 px 及 Chrome 原生 200% 縮放。代表畫面未發現整頁水平溢出或 axe WCAG 2／2.1 A、AA 違規。鍵盤、焦點、手機觸控模擬、Light／Dark／System 及 reduced motion 均有執行證據。 |
| I　回歸及交接 | PASS | `npm.cmd run build` 通過 TypeScript 和 Vite。完整 mocked Edge suite 119 passed。現有 Windows launcher harness 29/29 passed。實作、驗證及畫面準備供獨立審查。 |
| 實體螢幕閱讀器 | NOT RUN | 以瀏覽器 accessibility tree、鍵盤及 axe 檢查語意。 |

### Normal 與 Synthetic Demo

- Normal 使用新遷移、獨立空 PostgreSQL。初次 Data Explorer 顯示空狀態及 New Collection 連結，導覽全程為讀取及未送出的操作，Normal 畫面沒有 Synthetic Demo 提示。
- Demo 透過現有 `backend.experiments.demo_provision` 在另一 Compose project 產生三個受控基準。Fixture Listings 2 筆、Influencer Advertising and Sponsorship 8 筆、Market News and Economic Updates 8 筆，分別核對 Job／Request、Observation、Evidence 和兩種下載。市場資料有模擬價格提示。另以 M12 的介面建立新 collection，包含受控 Partial Request。實際驗證未使用整庫筆數作基準。
- Real Edge 瀏覽組合包含既有 Demo／M12、Topic、HTML、CSV、失敗 Capture 和獨立 Normal，另有兩個 M13 專項。Core HTML／CSV 端到端及 M6/M7 的分頁、Search／Detail capture 回歸也通過。POST 或 fixture revision 都在獨立測試環境。使用者的 Demo 保持原有資料。
- Mocked Edge 與 live 分開執行。合約資料由受控 PostgreSQL 和 fixture 提供。Mock 覆蓋空及錯誤頁面、503／network retry、混合型別、返回、重排、匯出錯誤和頁面狀態，並保留 M11 Shell 和 M12 新收集回歸。
- 初次 live 檢查發現 Python 路徑及沿用的舊 UI selectors，修正測試設定與 selectors 後重跑通過。第一次 M8/M9 smoke 有兩項缺 Redis 而跳過，遷入同一隔離環境的 Redis 後全八項通過。

### 瀏覽器與 UI Slop v1.7

Pass A 檢視寬窄版、巢狀操作和實際 payload。在 320 px 看到首筆資料被控制項推離首屏，另發現操作標籤未包含可見措辭及原生 Chrome 縮放截圖裁切。Fix Batch 收緊 Request 範圍及排序控制，放置實際價格／摘要，將長識別碼收合，對齊可見名稱和可及名稱，修正 Article breadcrumb 間距及窄版 Inspector 的焦點／捲動。延遲 503 harness 在 StrictMode 重複掛載後保持模擬直到 Retry，再轉真實 API。Pass B 以 Edge 157.0.4341.60 驗證 18 組代表狀態、焦點、返回與 Retry，未記錄非預期瀏覽器錯誤。Chrome 157.0.8103.51 使用瀏覽器設定 200%，DPR 2、712 CSS px，以原生 viewport 重新擷取。

- **AI Fingerprint Gate PASS**。Record 和 Evidence 關聯構成版面，樣式分別呈現清冊列、定位提示、實際狀態和擷取 metadata。
- **Evidence Gate PASS**。鍵盤流程、scope 和 Record identity、資料來源、空／載入／錯誤、返回及必要重排均有實際檢查證據。
- **Taste Gate PASS**。固定 Cobalt／Slate 與 M11 Shell，內容預覽和查證入口在同一個選取情境，窄版直接定位到可操作的 Inspector。

### 重現重點

在 `frontend/` 執行 `npm.cmd run build` 與 `npm.cmd test`。本次 Playwright 以 `PLAYWRIGHT_CHANNEL=msedge` 執行。Real suite 需 `M4_REAL_API=1`、`LOCAL_PROFILE_APPROVAL=1` 和隔離的 `API_PROXY_TARGET`。既有 Demo entry 使用 `M10_SYNTHETIC_URL`，CSV 解析可指定 `M9_TEST_PYTHON`。Normal 新資料庫測試須 `M12_EMPTY_NORMAL=1`。M13 專項以 `tests/m13-continuity.integration.ts` 執行，使用 `M13_QA_DEMO_URL` 和隔離的 `M13_QA_FIXTURE`，請參閱測試內的 loopback 及 Compose 名稱限制。

## 變更檔案

| 路徑 | 變更 |
| --- | --- |
| `frontend/src/features/results/RecordsExplorer.tsx`、`displayFields.ts` | 清冊、支援的 scope／sort／分頁、混合欄位、獨立範圍偏好及品質入口。 |
| `frontend/src/features/results/RecordInspector.tsx`、`RecordDetail.tsx`、`resultNavigation.tsx` | 共用檢查內容、URL lineage context、canonical Detail、焦點、捲動及可返回選取。 |
| `frontend/src/features/results/EvidenceDetail.tsx`、`api.ts`、`presentation.tsx` | 證據 metadata、capture 種類與安全位置、可用 scope 路徑及值呈現。 |
| `frontend/src/features/results/RecordExport.tsx`、`results.css` | 完整範圍下載說明及響應式清冊、Inspector、證據版面。 |
| `frontend/src/features/collection-jobs/JobDetail.tsx` | Job capture 種類、Request context 與 Evidence 返回。 |
| `frontend/src/features/topic-collections/Articles.tsx`、`support.tsx`、`topic-collections.css` | Latest、版本及觀測檢查，兩組可分享的分頁及連結。 |
| `frontend/tests/m13-continuity.spec.ts`、`results.spec.ts`、`dashboard.spec.ts` | 互動、焦點、窄版、混合欄位和舊入口回歸。 |
| `frontend/tests/m13-continuity.integration.ts`、`topic-collections.integration.ts`、`results.integration.ts`、`core-workflow.integration.ts`、`closure.integration.ts` | 真實持久資料、版本／證據／匯出關聯、失敗和 Partial 狀態。 |
| `docs/evaluation/M13-Data-Explorer-Design-Decisions.md`、`docs/evaluation/M13-screenshots/`、`M13-Implementation-Handoff.md` | 審核、設計決策、瀏覽證據及交接。 |

## 限制與下一里程碑

當新紀錄同時發布，REST offset page 成員可能移動，Inspector 會再次核對目前頁面。API 提供已保存的 Evidence metadata，原檔位元組驗證仍由既有 Core 機制負責。全資料集搜尋、任意欄位排序、全域 Export、原始 Evidence 瀏覽及 Version Diff 缺少現行產品契約。Operator Job 診斷重設為 M14 範圍，M15 依後續里程碑處理。

**GO 進入 M13 獨立審查。**
