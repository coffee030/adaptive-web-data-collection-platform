# M12 新收集工作區實作交接

- **交付分支** `feature/M12-new-collection-workflow`
- **M11 基準** `875c94c8f0c358904813fe1c41e1018034713049`
- **M12 實作驗證 commit** `3461d14922e1a25196ba729de47d3ea65f750090`

## 1. 版本庫與變更清單

Repository 為 `coffee030/adaptive-web-data-collection-platform`。以 `git ls-remote origin` 確認 M11 最新遠端 SHA 與已審閱 SHA 相符。M11 工作樹乾淨，遠端無同名 M12 分支。M12 在既有乾淨 checkout 從該 SHA 建立。上方 SHA 鎖定實作與測試，交接與截圖另由分支最新文件 commit 保存。分支交付範圍為 M12，M10 Draft PR #4 保持獨立。 [GitHub 分支](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M12-new-collection-workflow)

| 檔案 | 變更 |
| --- | --- |
| `frontend/src/app/App.tsx` | 既有 New Collection route 使用新的工作區入口。 |
| `frontend/src/features/topic-collections/{NewTopicRequest,TopicBrowser,CollectionSelection,CollectionReturn}.tsx` | 漸進式工作區、分頁目錄、核准來源及檢閱、詳情返回。 |
| `frontend/src/features/topic-collections/{collectionDraft.ts,api.ts,support.tsx}` | 草稿生命週期、資格核對、既有回應型別、分頁與進行中操作的取消範圍。 |
| `frontend/src/features/topic-collections/{Requests.tsx,TopicCatalog.tsx,topic-collections.css}` | Request 查閱、結果入口、管理頁返回連結與 M11 token 樣式。 |
| `frontend/src/features/sources/SourceDetail.tsx`、`frontend/src/features/profiles/ProfilePage.tsx` | 從原草稿進入時提供返回動作。 |
| `frontend/tests/{topic-collections.spec.ts,topic-collections.integration.ts,dashboard.spec.ts,core-workflow.integration.ts}` | 擴充行為、競態、狀態、可及性和真實收集測試，更新方式及可見名稱已改動的選擇器。 |
| `docs/evaluation/M12-New-Collection-Design-Decisions.md`、`docs/evaluation/M12-screenshots/`、`M12-Implementation-Handoff.md` | 低保真比較、生命週期、驗證、截圖及審閱資料。 |

## 2. 結構與操作

採用漸進式縱向工作區。桌面 Category 與 Topic 併排，同一頁按資料相依性呈現來源、Keyword 與檢閱。窄版選好 Category 後縮為摘要，可展開重新選擇。已選 Topic 在瀏覽器收合後仍顯示 Category。沿用 M11 Cobalt／Slate、Light／Dark／System、全域導覽及既有路由。UI Slop v1.7 的 Structural Direction 記錄三個方案，Information Relationships 與 Reactive Surfaces 以 Category → Topic → Binding → Job 決定呈現，Semantic Diversity 以目錄按鈕、核取方塊、狀態及摘要各自承載不同資料。 [設計決策](docs/evaluation/M12-New-Collection-Design-Decisions.md)

- **Topic Browser** 以現有 active-only REST 取得 Category 和 Topic，每次擴展 12 筆並讀取一筆作分頁判斷。已選 Category 決定 Topic 查詢，已選 Topic 才查詢其 bindings。Overview 傳入的 `topic_id` 透過 Topic 詳情及當前 Category 詳情驗證。缺失、格式錯誤及停用均可以回到目錄。目錄、深連結及來源請求各有局部 Retry。
- **Approved sources** 僅提供 eligible、未停用的實際 bindings。每組勾選一個 child Job，上限四組。版本號直接取自資料，詳情指向所用 Source 及 pinned Profile Version。刷新以 binding ID、Source ID、Profile Version ID 與設定 hash 核對，保留仍可確認的選取並回報被移除的項目。無資格時提供既有 Topic Bindings 入口。
- **Keyword 與 Review** 使用者可完整輸入及修改。去除前後空白後按 Unicode 字元數檢查 1–128 個可列印字元，並呈現精確的 Category、Topic、實際送出的 Keyword、來源和核准版本及預計 Jobs 數量。修改欄位或已核對的 pin 會失效舊檢閱。
- **Run and Inspect** 以現有 POST 建立 Request，並進入同一持久 Request 的 Detail。由 GET／既有輪詢顯示實際狀態、各來源 Job 與有效紀錄。成功建立與 Job 執行結果各依自己的狀態顯示。可由此查看 request-scoped Records、Job details、Quarantine、Evidence、Article History、前一輪、Refresh 與 CSV／JSON 下載。Job 入口帶回原 Request，直接 Job／Request 深連結仍可用。

## 3. 草稿與送出

URL 僅包含可分享的 Topic ID。路由歷史保留草稿識別碼。每個已載入的頁面在 JavaScript 記憶體保留最近 20 個草稿脈絡，包含已瀏覽來源範圍、所選 pin、Keyword、Review 及未確認的 POST。開始新的 New Collection 建立新草稿。換 Category 或 Topic 時清除不相容選取及 Review，保留 Keyword。Profile／Source 詳情的 Back 或 Back to collection 回到原 history entry 並重查選取。焦點在入口仍可用時回到該連結，被移除時回到來源標題。一般瀏覽器歷史沿用 M11 ScrollRestoration。重新載入頁面會清除記憶體草稿。

首送前重讀 Topic、當前 Category 與使用者已載入的來源分頁，對照檢閱內容。REST 使用既有 `POST /api/v1/collection-requests` 與排序後的 `binding_ids`、`topic_id`、`keyword`、UUID `request_key`。使用現有 request intent 工具。每個 tab 的 sessionStorage 只存送出指紋與對應 UUID。若儲存不可用，仍以原記憶體意圖重試。這個 storage 項目於已確認成功或確定拒絕時移除。

請求執行中阻擋重複動作。若首個 POST 的結果未確認，恢復操作只重送原內容及原 UUID。後端先檢查是否應回傳已建立的相同 Request，再對可能新建的交易檢查當前授權與資格。首次寫入與重播分別以 201、200 確認。成功時清除敏感草稿欄位並用 Request Detail 替換當前 history entry。可回到的同草稿舊項目只顯示原 Request 或開始新收集。刷新、單來源 Job 與其他入口繼續使用各自原有的重試路徑。

## 4. 驗證結果

PASS 表示已執行且符合預期，FAIL 表示觀察到斷言或流程失敗，PARTIAL 表示只完成部分驗證，BLOCKED 表示有外部依賴阻擋，NOT RUN 表示未執行。

| 驗證 | 狀態 | 證據 |
| --- | --- | --- |
| Gate A、Backend API 與持久化 | PASS | M8 Collections 與 M9 Record Export 的既有 PostgreSQL 套件 8 passed。Backend、授權、資料庫、Demo、launcher 和 lockfile 未列入變更。 |
| Gates B–E、前端 REST 邊界測試 | PASS | Edge mocked suite 114 passed。含 101 Categories、101 Topics、讀取競態、無來源、最多四個、pin 失效後重新檢閱、深連結、Unicode、201／200、重複操作、丟失回應、403／409／422／503、Source／Profile 返回和 Back／Forward。 |
| Gate F、Request Detail | PASS | Mocked REST 測試涵蓋 Pending、Running、Partial、Failed、Succeeded 及輪詢。真實 Demo 執行 Succeeded 與 Partial、Request → Job → Evidence，驗證 API 查得持久紀錄。 |
| Normal 空資料庫 | PASS | 獨立新建 PostgreSQL，全新遷移後查詢 7 組空清單。390px Edge 顯示設定入口，無 Demo banner 或可選來源。 |
| Synthetic Demo 與隔離 | PASS | Launcher 用 checkout 專用設定、volumes 與 loopback ports。初次 preset provisioning 驗證 6 Jobs、18 Records／Observations、28 份 Evidence 和 6 份匯出。再從 M12 UI 實際提交 4 次並核對持久資料，既有 Demo 專案未用作寫入目標。 |
| 匯出及既有 live browser regressions | PASS | 受控 fixture live suite 17 passed，三個需獨立 Normal／Demo 的案例另跑 3 passed，共 20 項。涵蓋單來源 HTML／CSV、來源及 Profile 核准、Job 與 Evidence、CSV／JSON、Article History、Refresh、資料庫重啟與重播。 |
| Launcher | PASS | Windows PowerShell regression 29/29。One-click 啟動路徑以 `-NoBrowser -NonInteractive` 執行並從 Edge 進入實際生成的 Demo。 |
| Gate G、Browser QA 與可及性 | PASS | Edge 157.0.4341.60 測 1440、900、390、320px，Light／Dark／System、320px touch 和 reduced motion。Chrome 157.0.8103.51 實際 Page zoom 200%，DPR 2、clientWidth 和 scrollWidth 都是 712 CSS px，檢閱與送出按鈕可聚焦。 |
| Gate H、建置與交接 | PASS | `npm --prefix frontend run build` 含 TypeScript，`git diff --check`、測試 commit 參考、截圖及審閱文件。 |
| 實體 screen reader、cold installer、完整 Backend 全套、公開網站 | NOT RUN | 已執行 axe、鍵盤操作、Launcher startup 及相關 Backend suite。全部資料來自受控本機 fixture。 |

### M12 UI 提交的真實 Demo 結果

| Topic | Keyword | Request ID | 結果與已驗證紀錄 |
| --- | --- | --- | --- |
| Fixture Listings | `quick` | `601399d9-f1ea-4d44-9e4e-1949cce3c4f8` | Succeeded，2 Jobs，2 筆。先由真正後端回 201 並丟棄瀏覽器回應，再以相同 UUID 重播取得 200 和同一 ID。 |
| Influencer Advertising and Sponsorship | `partnership` | `4d9e4081-e095-47ab-9223-a48e73e5d2d8` | Succeeded，2 Jobs，8 筆。 |
| Market News and Economic Updates | `market` | `d6a89f29-3eb5-4f13-aa6b-047122981fb7` | Succeeded，2 Jobs，8 筆。Records 頁和資料內容標示 `SIMULATED DATA — NOT LIVE MARKET PRICES`。 |
| Fixture Listings | `detail404` | `d07efc7c-5f67-465d-9882-bd561ebf96e6` | Partial，2 Jobs，2 筆。兩個來源都有可查閱的錯誤與 Evidence。 |

M12 Normal／Demo 及六份 baseline 匯出的 Edge live 入口是 `tests/topic-collections.integration.ts -g "M12|launcher dashboard"`，3 passed。環境使用 `M4_REAL_API=1`、獨立 Normal API 的 `API_PROXY_TARGET`、`M12_EMPTY_NORMAL=1` 及獨立 Demo dashboard 的 `M10_SYNTHETIC_URL`。第一次全套 live 檢查發現過時 UI 選擇器、CSV 恢復逾時及 cached fixture 的 LF／CRLF 雜湊差異。保留實際行為和雜湊斷言，對齊 M11 介面名稱，從同一 checkout 建置 fixture 後，包含恢復測試的整套重跑通過。一般 fixture 回歸以 `backend/experiments/m10_environment.ps1` 設定獨立 Compose project，fixture image 從同一 checkout 建置。

## 5. 視覺與可及性審閱

Pass A 在 Edge 操作及檢視桌面來源／檢閱、手機檢閱及 Partial、Normal 空庫。發現單一 Topic 選項易看成靜態文字、狹窄畫面的版本號被切開、空庫提示仍要求選分類，以及初始 Request 已在前方突出 Refresh。修正批次讓 Topic 操作可掃描、版本標籤完整、空庫集中設定入口，並優先強調已有紀錄及 child Jobs。Pass B 重拍主要狀態，檢閱完成後確認焦點、返回、窄版、觸控及 200% reflow。AI Fingerprint／Taste 審閱的畫面結構由目錄、來源列及實際檢閱內容形成，工作區沒有重複的步驟卡或統計條。

axe WCAG 2／2.1 A／AA 掃描在測試畫面回報零 violations。另以瀏覽器逐步按 Enter、Tab、Space 選取主題及來源，從 Keyword 進入 Review，開啟 Profile Version 後返回。觀察到相同草稿內容及 Profile 入口焦點恢復。320px 觸控測試檢查返回後的選取，Console 無未處理例外。截圖的 Loading 與 HTTP 503 是瀏覽器攔截重現，其他截圖來自實際隔離環境。

| 畫面 | 截圖 |
| --- | --- |
| 1440px Topic 目錄與一個已勾選來源 | [Topic](docs/evaluation/M12-screenshots/topic-browser.png) · [Sources](docs/evaluation/M12-screenshots/approved-sources.png) |
| 檢閱與縮放 | [桌面](docs/evaluation/M12-screenshots/review-desktop.png) · [390px Dark](docs/evaluation/M12-screenshots/review-mobile-dark.png) · [320px Dark](docs/evaluation/M12-screenshots/review-narrow-dark.png) · [Chrome 200%](docs/evaluation/M12-screenshots/review-chrome-zoom-200.png) |
| 900px 讀取及錯誤恢復 | [Loading](docs/evaluation/M12-screenshots/simulated-loading-tablet.png) · [HTTP 503](docs/evaluation/M12-screenshots/simulated-api-503-tablet.png) |
| 真實 Request、結果及 Normal 空庫 | [Succeeded](docs/evaluation/M12-screenshots/request-succeeded.png) · [Partial](docs/evaluation/M12-screenshots/request-partial.png) · [模擬金融紀錄](docs/evaluation/M12-screenshots/demo-financial-records.png) · [Normal](docs/evaluation/M12-screenshots/normal-empty.png) |

## 6. 限制與交接結論

- Category／Topic 目錄採分頁瀏覽。API 沒有全文搜尋。現有 eligible bindings endpoint 也沒有按 ID 單查。資格刷新只重讀已瀏覽的 24 筆分頁範圍。如果清冊順序移動至此範圍外，會移除無法驗證的選取，可繼續 Load more 找回該項再選取。
- 重載或關閉頁面會失去尚未送出的草稿及未確認 POST 畫面。sessionStorage 可用時，重新輸入完全相同的合格意圖會沿用既有 UUID。送出結果也可從 Collection requests 追查。
- M13 預留 Data Explorer 和 Article History 的深度導航及狀態。M14 預留維運表單、工作診斷與全站一致性調整。

**GO，可以交由獨立審閱。M12 授權、資格核對、UUID 重播、真實提交與結果交接均通過。**
