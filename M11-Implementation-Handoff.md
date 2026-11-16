# M11 Implementation Handoff

**建議 GO，交付獨立審閱。** M11 的驗證範圍為 UI Slop、前端基礎、App Shell、導覽和 Overview。

| Git | 識別 |
| --- | --- |
| 交付分支 | `feature/M11-ui-foundation-overview` |
| 實作及驗證證據 commit | `8e4f400b6492502a048e62683ea9d022fb3b36ff` |
| M10 基準 | `1572fc8a8aab05f0d81a81c9b0a7ffc994218974` |

分支 HEAD 包含本交接文件，上一個 commit 是表內的實作版本。 [交付分支](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M11-ui-foundation-overview) · [實作 commit](https://github.com/coffee030/adaptive-web-data-collection-platform/commit/8e4f400b6492502a048e62683ea9d022fb3b36ff)

## 審核與設計

- Git 歷史、GitHub 遠端分支及 Draft PR #4 的 HEAD 相符。經授權的 GitHub 帳戶可讀寫。Open PR 為 #1–#4。M11 使用獨立 checkout，避免覆蓋本機 M10 的不同歷史。已審閱 React Router、REST client、全域 CSS、FYP frontend skill、Impeccable 4.9.0 及其 Operate／Audit 參考、Playwright／axe 和 M10 兩種啟動模式。 [M10 Draft PR #4](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/4)
- UI Slop 1.7.0 固定在 `6f8a7d22aff293e0e92183df93cf5d53e886ba1a`。上游以 `release/v1.7-task-continuity` 分支交付，版本由該 commit 的 changelog 確認。Codex 從 M11 checkout 使用 `.agents/skills/ui-slop/SKILL.md`。36 個上游檔案逐一比對 SHA-256，包含 MIT LICENSE、ACKNOWLEDGEMENTS、reference 與 upstream evidence。Impeccable 進入檔改為 `SKILL.legacy.md`，既有命令路徑、sidecar 及歷史驗收參考仍可供重現。 [UI Slop 固定版本](https://github.com/suna-kabo/ui-slop/tree/6f8a7d22aff293e0e92183df93cf5d53e886ba1a)
- 比較工作台與請求清冊、分階段引導畫布和事件時間線後，採用工作台及清冊。目錄讓操作者直接開始，清冊將 Request、子 Jobs、失敗／部分成功及對應的結果入口排在一起。清空時以來源設定引導。 [低保真比較及延續性合約](docs/evaluation/M11-Frontend-Redesign-Decisions.md)
- 共用的 Cobalt／Slate、字型 fallback、間距、狀態和焦點規則用於桌面與窄版。Shell 和 Overview 的版面 CSS 各自有範圍。新增導覽表面 token，既有功能頁繼續使用共享控制項、表格、狀態字色及原本的細節 reflow。 [設計系統](DESIGN.md)

## 操作流程

1. Workspace 依次提供 Overview、New Collection、Collection requests、Data Explorer。Operations 提供 Sources、Topics & bindings、Collection Jobs、Single-source & CSV。手機保留四個主流程入口，Operations 可展開並以 Escape 返回開關。Profiles 從 Sources 到達，Evidence 從 Request、Job 或 Record 的關聯連結到達。
2. Overview 用現有 API 預覽最多六個 active Topics 並讀取核准綁定。選擇可用主題會帶入其 Topic，表單重新讀取 Category 與 Topic 並查詢 eligible bindings。來源仍需操作者明確選擇。已檢查完整預覽仍無可收集主題時，Manage sources 成為主要操作，旁有 Topics & bindings 設定入口。
3. 最新五個 Request 依 API 新舊順序排列，顯示 topic、keyword、UTC 時間、子 Job 狀態摘要和已驗證紀錄連結。Running／Pending 透過獨立查詢提供全域狀態入口。下方列出最新五個 Jobs 的結果與錯誤，以及最新四筆持久紀錄的入口和 API 原有的 dataset 提示。
4. Router 保持原有 URLs、query scope 及瀏覽器 Back／Forward。跨頁焦點移至 main，Evidence hash 由其既有標題接收。失敗時可在相應區段 Retry。Refresh activity 重讀活動資料，並在更新期間保留已讀取資料。Theme 支援 Light、Dark 及 System。

## 驗證

| 檢查 | 結果 | 實際觀察 |
| --- | --- | --- |
| TypeScript 與 Vite production build | PASS | `npm run typecheck`、`npm run build` 成功，build 包含工作區 favicon。 |
| Playwright 前端回歸 | PASS | Edge 91 passed。涵蓋主題資格、帶入 Topic、未勾選來源、Loading／503／Retry、正在執行的 Jobs、Partial／Failed、焦點、導覽和既有功能。 |
| Normal Mode | PASS | 在隔離新資料庫啟動 Windows launcher，PostgreSQL、Redis、Alembic、FastAPI、Worker 和 Dispatcher 就緒。七個 API lists 都回傳 `[]`，桌面與手機均可由空狀態前往 Sources。 |
| Synthetic Demo | PASS | 從運行中的 M10 Demo API 取得 Fixture Listings、Influencer Advertising and Sponsorship、Market News and Economic Updates。各自核對 Topic preset、兩個 baseline child Jobs 及持久紀錄。既有 live test 1 passed，驗證六個 CSV／JSON 下載和模擬財務警示。另一次已保存的失敗請求及其兩個來源錯誤出現在清冊及 Jobs。 |
| Launcher smoke | PASS | `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/windows/Test-Launcher.ps1`，29/29。用既有 BAT 啟動 fresh Normal Mode，確認實際 API 與前端代理。 |
| 主流程及巢狀歷史 | PASS | 真實 Demo 以觸控打開三個 Topic，再從 Request 打開子 Job Evidence、連續返回、打開同 Request 的 scoped Records，並驗證 Back／Forward。 |
| Light／Dark／System | PASS | 真實頁面手動切換 Light／Dark 及 System。回歸驗證 System 回應環境設定，顯式主題在換頁及 reload 後保留。 |
| Viewport、溢出及 200% | PASS | Edge Chromium 157.0.4341.60 實測 1920、1440、1280、901、900、768、430、390、360、320 px。Chrome 實際 Page zoom 200%，DPR 2、clientWidth 與 scrollWidth 同為 712 CSS px，鍵盤可進入 New Collection 並返回。 |
| 焦點、鍵盤、語意、reduced motion | PASS | axe WCAG 2.0／2.1 A／AA 檢查無違規。核對 Chromium accessibility tree 的 main、heading、regions、link names 和文字狀態。驗證 Skip、Escape、Focus outline、Retry 焦點及主導覽。Reduced-motion 模式的主題連結無轉場。 |
| Live console 和 API | PASS | 最終實機兩種模式的檢查路徑無 console errors、page errors 或非成功 API 回應。Mock suite 的 Vite log 有未攔截請求的預設代理訊息及測試停用 sessionStorage 觸發的警告。 |
| UI Slop Browser QA／AI Fingerprint／Evidence／Taste | PASS | 目視比較原版、第一次改版、修正後的桌面／手機與灰階畫面。主題目錄、Request 清冊、分組導覽及子工作結果在灰階仍清楚。實際操作與狀態文字構成可辨識的工作台。 |
| 外接螢幕閱讀器 | NOT RUN | 使用 Chromium accessibility tree、axe 及鍵盤驗證。 |
| 完整 Backend pytest、冷安裝、系統預設瀏覽器啟動 | NOT RUN | 本次驗證使用現有 M10 backend 與隔離 launcher smoke。 |

## 瀏覽器修正與截圖

首次改版在 390 px 下重複的資格文字、Demo notice 及分開換行的操作，把第一筆 Request 推到第一個 viewport 邊緣。縮短 notice、移除重複文案並將 Refresh 和歷史入口同列，重新截圖後第一筆失敗請求在首屏可讀。空庫主動作改成來源設定，更新 Retry 後的焦點，並加入瀏覽器 icon 修正啟動時的 `/favicon.ico` 404。所有交付截圖均已目視檢查。Chrome zoom 截圖取自 compositor，viewport 為 1424×805 實體像素。

| 狀態 | 實際截圖 |
| --- | --- |
| Synthetic Demo，桌面 1440 px | [Light](docs/evaluation/M11-screenshots/demo-desktop-light.png) · [Dark](docs/evaluation/M11-screenshots/demo-desktop-dark.png) |
| Synthetic Demo，手機 390 px | [Dark](docs/evaluation/M11-screenshots/demo-mobile-dark.png) |
| Normal 空狀態，System 選用 Light | [桌面 1440 px](docs/evaluation/M11-screenshots/normal-desktop-light.png) · [手機 390 px](docs/evaluation/M11-screenshots/normal-mobile-light.png) |
| Synthetic Demo，Chrome Page zoom 200% | [Chrome viewport](docs/evaluation/M11-screenshots/demo-zoom-200.png) |

## 產品範圍與後續

- Git diff 核對 Backend Core、REST API 實作、資料庫、Demo provisioning、BAT／PowerShell launcher、套件及 lockfile。現有授權、Draft／Preview／Validate／Approve、Topic Bindings、Requests／Jobs、Data Explorer、Evidence／Provenance、Article History／Refresh 及 CSV／JSON 流程繼續使用原有契約。前端回歸與 live 測試涵蓋上述主要入口。
- Overview 是以現有 API 提供的預覽。較大的目錄從 New Collection 瀏覽全部，完整活動可在 Request 及 Job 頁查看。Pending／Running 由進入頁面或 Refresh activity 更新。在受測手機路徑中，Back 返回同一 Overview，非同步資料載入時的捲動位置從 188 px 變為 172 px。下一階段需為長清冊定義精確的返回位置和觸發元素恢復。
- **M12** 處理 New Collection 的 Topic／來源選擇延續性和 Request → Job 導覽。**M13** 處理 Evidence-first Record Ledger、Inspector、Record／Evidence 關聯、Article History 返回，以及 filter／sort／selection／scroll 的生命週期。**M14** 處理來源／Profile／Binding 管理、Job 診斷及整體一致性。 [延續性需求](docs/evaluation/M11-Frontend-Redesign-Decisions.md#導覽及狀態生命週期)

| 驗收 Gate | 結果 |
| --- | --- |
| A Skill、B Product Integrity、C Visual/Structural、D Usability、E Accessibility/Responsive、F Regression | PASS |
| G Independent Review Readiness | PASS，程式碼、驗證步驟、截圖、限制及 commit 俱備，等待使用者獨立審閱 |
