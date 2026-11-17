# M14 操作者設定工作區交接

M14 以真實持久狀態引導來源授權、擷取規則核准和 Topic Binding。隔離測試從待授權 Source 走到兩個成功的子 Jobs，並查到對應的 Records 與 Evidence。

| Git 基準 | 版本 |
| --- | --- |
| 起始 M13 SHA | `ff211bef68dec3e304b5fa253d89a50230e25255` |
| 最終 M14 實作 SHA | `425a8edc646672b940cb1b468e17dc27e2e036ea` |
| 交付分支及交接 commit | [feature/M14-operator-configuration-workspace](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M14-operator-configuration-workspace) |

## 儲存庫審核與設計

GitHub compare 核對 M13 遠端 HEAD、獨立審閱 SHA 和乾淨的本機 checkout 一致。實作前檢查 AGENTS、PRODUCT、DESIGN、M11–M13 決策與 M2／M4 Closure／M7／M8 契約。實際查核包括 React routes、API 客戶端、FastAPI 路由、Source／Profile 服務、PostgreSQL revision 與 idempotency、Category／Topic 及 Binding eligibility。

低保真比較包括 A 以 Source 為中心、B 以資格矩陣為中心、C 逐步設定。採用 A，將 access policy、版本清冊及下一步放在 Source 明細，將規則及樣本檢查置於同一 Profile 路徑。B 的跨物件矩陣需要更多讀取才能如實表示資格。C 的逐步路線使回看既有版本與直接連結較繁複。

採用 FYP frontend skill 與專案 vendored UI Slop v1.7（`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`）。Structural Direction、Information Relationships、Reactive Surfaces、Semantic Diversity、Interaction Hierarchy、Task Continuity、Accessibility 及 Responsive Layout 用於版面與狀態設計。兩輪實際瀏覽檢視、修正項目及狀態圖見 [M14 設計決策](docs/evaluation/M14-Operator-Workspace-Design-Decisions.md)。

## 交付行為

| 工作區 | 操作者行為及系統合約 |
| --- | --- |
| Source Catalog | 20 筆本機分頁直接使用真實 Source 陣列。顯示 Adapter、存取授權、Permission reference 及依該 Source 狀態推導的下一步。Source links、loading、empty、Retry、分頁返回焦點保留。 |
| 註冊與授權 | 登記名稱、Adapter、自報許可參考、origins 或 datasets、適用路徑和節流間隔。新登記從 pending 開始。201 顯示登記成功，200 顯示恢復既有登記。結果未確認時同一表單用原值與 UUID 安全重送。新值須先處理未確認的登記。授權與撤銷各自要求確認，結果後讀取最新 Source。 |
| Source Policy | 明細顯示可用輸入、Permission reference 和狀態，origin 下方列出相應 path prefixes。Source ID 和請求間隔可展開。Permission reference 指向操作者應核對的許可資料。撤銷影響未來收集資格。 |
| Profile Editor | 分區呈現 record identity、collection mode、CSS／XPath、keyword search、分頁與 request limits、型別及擷取欄位、CSV headers、Article mapping。摺疊區段保留同一份 Draft。欄位錯誤連至相應輸入。 |
| Draft 和並行保存 | 未存變更、已存 Draft、revision 及請求中狀態各自呈現。PUT 具 `expected_revision`。兩個編輯器得到 200／409 時，後到編輯器可保留自己的輸入，對照伺服器內容，再明確選用伺服器版本。無法確認的寫入先讀伺服器。瀏覽器離頁與重新載入保護沿用既有 blocker。 |
| Preview／Validate | 以保存版本執行樣本檢查。Preview 顯示 candidates，Validation 顯示實際 counts、樣本及逐筆錯誤。預檢與回讀核對 revision。更動 sample 或保存 Draft 後需重驗。 |
| Approval | Review 綁定同一 Source、Profile Version、配置 hash 及 passing report。操作者填寫自報標籤、勾選確認再送出。FastAPI 仍決定最新 report、revision、Source 狀態及批准結果。Vite 的 loopback 模式繼續限制 Profile 與 Binding 的操作者動作。 |
| 版本歷史 | Draft／Approved／Retired、批准時間與標籤可在 Source 清冊檢視。批准及退役版本以唯讀設定呈現，ID、hash 和 report ID 可展開。設定變更透過新的 Draft。 |
| Category／Topic | 可分頁瀏覽、建立、更新名稱與 active。選取 Category 後讀取其 Topics，建立 Topic 時提交該 Category，既有 Topic 的 Parent 明列。停用會影響未來收集，過往 Request 保留歷史入口。 |
| Source Bindings | 先看真實 Binding 清冊、資格、批准標籤和 UTC 時間，再明確選取已授權 Web Source 和相容的已批准 keyword Profile。新增、停用和恢復都需獨立確認。每次寫入嘗試後重讀當前服務狀態。Unavailable 使用 API 的資格及已有目錄資料，Source／Profile 詳情可供查核。 |
| M12 交接 | 合資格的 Topic 以既有 `topic_id` 開啟 New Collection。在 M12 重新讀取可用 Binding 並由操作者選取、輸入 keyword、檢閱及提交。返回 Source、Profile、Topics 及 New Collection 保留有意義的 URL、分頁及焦點。 |

## 驗證結果

| 檢查 | 狀態 | 實際證據 |
| --- | --- | --- |
| TypeScript 與 Vite production build | PASS | `npm.cmd run build`。針對 Profile、Category／Topic 和 Bindings 分割 route chunks，同時重驗快速 Back。 |
| Mocked Playwright 全回歸 | PASS | Microsoft Edge 157.0.4341.60，134 tests 全通過。最後的兩次聚焦執行再查 Source 三狀態／路徑輸入／同 UUID、320 px touch、保存中離頁及拒絕樣本。 |
| 真實 Source／Profile／Core | PASS | 11 個 Edge integration tests。包括 201、回應遺失後的 200、同 key 不同 payload 的 409（聚焦重跑），及拒絕不符 origin 的政策。兩個 browser editors、實際 stale report、local origin 403、Revoked Source、CSS／XPath、Web／CSV 核准、Core Job、M6 pagination 與 M7 detail captures 均有真實資料。 |
| 真實 M14 全流程 | PASS | 1 個獨立端到端場景。人手確認 Web 存取、建立 Draft、Preview、Validate、Profile approval、建立 Category 與 Topic、核准兩組 Binding、停用和恢復、M12 顯示並再驗資格。Request `9bf8ead2-d52e-4ed7-8b30-3e0592e1988a` 的兩個 Jobs 成功且合共有兩筆 Records。重收集 `7ea97588-9614-4557-9ba8-726efb34738e` 保留 lineage。受控 404 另產生真實 Partial Request `3f768752-6bb9-4093-ae08-6339c9030661`。撤銷一個 Source 後，其 Binding 顯示 Unavailable，另一筆仍 Eligible。 |
| Normal | PASS | 寫入測試資料前，在新遷移的隔離 PostgreSQL 執行 2 個測試。Sources、Categories、Topics 與歷史初始為空，M14 與 M12 顯示 setup。新寫入的 Source 為 pending，須獨立授權。 |
| M10 Synthetic Demo | PASS | 2 個讀取測試。Fixture Listings、Influencer Advertising and Sponsorship、Market News and Economic Updates 各有兩個持久 eligible Bindings，Source／Profile hash 與審批可追溯。既有 Request 讀取及 JSON／CSV 匯出通過，使用既有隔離 Demo。 |
| M11–M13 | PASS | Shell 鍵盤與主題、M12 selection／deep link／失效重驗／replay、M13 Record／Evidence／Article 的返回、範圍與歷史皆通過對應 mock。真實 M14 與 Core 測試走過 M12、Records、Evidence、Article 及 Request history。 |
| 瀏覽器與可及性 | PASS | 兩輪畫面檢查。Edge 以 1440、900、768、390、320 CSS px 及原生 200% 操作。Light、Dark、System、reduced motion、鍵盤、觸控模擬、可見焦點、返回焦點及長內容重排已檢查。受檢頁的 axe WCAG A/AA runs 回報零 violations。 |
| 實體螢幕閱讀器／既有選用停庫重啟分支 | NOT RUN | 有檢查 DOM roles、可及名稱與 live error。此次資料庫隔離測試涵蓋真實 API 及 controlled failures，未啟用 M4E 停止 PostgreSQL 的選用分支。 |

## 瀏覽器與 UI Slop Gates

- **Pass A** 看見 Source 註冊動作落出首屏、Profile 面板的可操作內容過窄、Binding review 與清冊分離。另在全回歸發現快速 Back 可能沿用舊 M12 eligibility。
- **Fix Batch／Pass B** 將 origin/path／interval 依關係排列，限制 Profile 版面寬度，增加段落跳轉，將停用及恢復檢閱放到清冊，將 loading boundary 放入相應 operator routes。重跑主流程與 M12 返回測試。校正原生縮放畫面擷取後再目視確認。代表性 Operator 測試未觀察到非預期 page errors。既有 mock suite 的刻意阻擋 sessionStorage 與未匹配 mock 請求可產生已記錄的開發 proxy 訊息。
- **AI Fingerprint Gate PASS**、**Evidence Gate PASS**、**Taste Gate PASS**。布局由 Source Policy、Profile 檢查及 Topic 與 Binding 關係決定。狀態、設定、檢閱和回程各有相應語意。窄版清冊保留欄名與操作，用同一套 Cobalt／Slate。

共 [24 張截圖及來源索引](docs/evaluation/M14-screenshots/README.md)。Pass B 的受控 Capture 對照真實流程。手機、模擬 503 與 viewport 各有清楚的 mock 標記。200% 取自原生 Edge 視窗，DPR 2、708 CSS px，三個頁面寬度與 viewport 一致。

## 變更檔案

| 路徑 | 變更 |
| --- | --- |
| `frontend/src/app/App.tsx`、`frontend/src/main.tsx` | 操作者路由級載入與樣式入口。 |
| `frontend/src/features/sources/{SourceList,SourceCreate,SourceDetail}.tsx`、`api.ts`、`sources.css` | 清冊、政策表單、兩階段授權、重讀及版本目錄。 |
| `frontend/src/features/profiles/{ConfigurationEditor,ProfilePage,ProfileChecks,ProfileResults}.tsx`、`profiles.css` | Draft 分區、revision／衝突對照、樣本與核准、唯讀配置。 |
| `frontend/src/features/topic-collections/{TopicCatalog,TopicBindings,support}.tsx` | 分類關聯、伺服器分頁、Binding review 及 M12 深層連結。 |
| `frontend/src/features/operator/{operator.ts,operator.css,navigation.tsx}`、`frontend/src/lib/api.ts` | 共享觸發點返回、local operator 檢查、響應式資料列與可讀取 HTTP status 的共用 POST。 |
| `frontend/tests/{operator,profiles,sources,topic-collections}.spec.ts` | 操作、失效、衝突、replay 和 responsive／axe 覆蓋。 |
| `frontend/tests/{closure,core-workflow,operator,sources,topic-collections}.integration.ts` | 隔離 PostgreSQL/Core 操作、M10／Normal 驗證、持久記錄及畫面證據。 |
| `docs/evaluation/M14-Operator-Workspace-Design-Decisions.md`、`docs/evaluation/M14-screenshots/`、本交接 | 審查基準、設計比較、驗證及證據。 |

## 重現及限制

- 在 `frontend/` 執行 `npm.cmd run build`、`npm.cmd test`。本次使用 `PLAYWRIGHT_CHANNEL=msedge`。設定 `M14_CAPTURE_OPERATOR=1` 會保存代表性畫面。
- 真實測試使用新命名的 Compose project `collection-m14-operator-qa`、獨立的 PostgreSQL／Redis／Evidence volumes 及 Compose controlled fixture。運行的是 M13 同款 Core image `122f278b04b6`。使用 `M4_REAL_API=1`、`LOCAL_PROFILE_APPROVAL=1`、隔離 `API_PROXY_TARGET`，針對 `closure`、`core-workflow`、`profiles`、`sources` integration，及 `topic-collections.integration.ts --grep "operator configures"`。CSV 匯出驗證可設定 `M9_TEST_PYTHON` 指向已安裝的 Python。
- Fresh Normal 使用 `M14_EMPTY_NORMAL=1`（M12 用 `M12_EMPTY_NORMAL=1`）。既有 Demo 讀取使用 `M10_SYNTHETIC_URL` 指向隔離 Demo frontend，只運行驗證已存配置和 Request 的兩個指定測試。全部收集樣本來自受控 fixture。
- Category／Topic 的 PUT 與 Source 授權使用現有合約，前端重查可察覺已發生的變更。缺少 revision token 的寫入仍受既有最後寫入行為限制。Binding API 沒有逐筆失效原因欄位。
- 核准標籤是本機自報 audit metadata。設定的 loopback console 適用於可信本機操作者。CSV Source 授權繼續使用可信本機 API。Profile Draft 編輯只保存於目前頁面與已提交的伺服器版本。
- M15 處理 Collection Jobs、執行事件、Worker Monitoring、Retry、Quarantine 等維運呈現。M16 處理跨里程碑與展示準備。

**驗收 A–I 為 PASS，建議 GO 進入 M14 獨立審查。**
