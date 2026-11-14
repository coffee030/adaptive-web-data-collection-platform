# M0 Repository Baseline and Prototype Verification

盤點日期為 2026-11-14（香港時間）。範圍為使用者指定的 FYP 工作區及其中的 `Adaptive-Web-Data-Collection-Platform/` 新專案根目錄。

| 項目 | 盤點結果 |
| --- | --- |
| 工作區基線 | 原工作目錄只有 `docs/design-system/dashboard-guidance.md`、`skills/` 和三份 FYP／課程參考文件。`git status` 回報 `not a git repository`。既有 branches、Git diff 和 remotes 無法在原工作目錄取得。 |
| Source、測試和部署 | 原工作區沒有可執行 backend／frontend、依賴清單、測試、fixtures、Compose 或 `.github/workflows/`。新根目錄的 `backend/` 是本次 Spike。 |
| 指引 | `skills/AGENTS.md` 在 `skills/` 的作用域內。`skills/.agents/skills/` 提供 `fyp-backend-feature`、`fyp-frontend-design`、`fyp-source-adapter`、`fyp-quality-review`。本次採用後兩者的受控 fixture、安全政策和驗證指引。 |

## 文件與決策依據

- **已確認** Modular Monolith 加獨立 Celery workers，Scrapling 負責 HTTP／Parsing，Core 管理安全策略及 jobs，Profile 經驗證和人手批准才可供正式 Job 使用。
- **正式 Proposal** FR01–FR15、NFR、時間表及評核條件。現行 Scrapling 路線和延後功能的影響見 [ADR](../decisions/M0-architecture-decisions.md)。
- **建議** 沿用受控 pagination、證據 hash、robots 和失敗處理的驗收案例。Dashboard guidance 屬後續 milestone 的設計提案。
- **待確認** IA 來源權限、平台、matching criteria、輸出和驗收條件，以及正式 Proposal 的技術敘述是否需修訂。

## 原型證據

Teammate brief 點名 `web_scraping_public_demo`，描述 HTTPX fetching、Beautiful Soup pagination、受控網站、raw HTML／metadata／hash、CLI 和保存的測試結果。指定工作區內未提供預期的 `web_scraping_public_demo/` 原始碼、`web_scraping_public_demo.zip` 或其測試與依賴鎖檔。既有原型測試 **BLOCKED**，文件中的結果為 **未核實原型聲稱**。本次 [Spike 結果](M0-scrapling-spike.md) 屬新實驗。

可沿用的設計包括 fixture ground truth、page budget、loop prevention、原始 evidence 及錯誤分類。HTTPX／Beautiful Soup fetching 和解析路徑屬舊方向，需在取得獲准範圍內的 source 後再判斷有否可直接重用的 policy 或 fixtures。
