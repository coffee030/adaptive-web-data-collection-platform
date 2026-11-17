# M16 最終 MVP 實作交接

## 版本與審查狀態

| 項目 | 觀測 |
| --- | --- |
| 最新已審閱起點 | M15 `0b609b198146fdc2e0ab494e7a4a3b58083abc5d` |
| M16 最後程式實作提交 | `185981553a14bf005345a5761eb549aa216a785c`。發行文件與 GitHub 審驗結果以獨立文件提交保存。 |
| Integration branch | [feature/M16-final-mvp-acceptance](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M16-final-mvp-acceptance) |
| Draft PR | [#5 · M16 — Final MVP Acceptance and M6–M16 Integration](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/5)，目標 `main`。 |
| GitHub Actions | [Draft PR #5 即時驗證報告](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/5/checks)。本機 frontend build 和 Linux unit-check 選取的 187 項測試已通過。 |
| 獨立技術審閱 | PENDING |
| Normal PR merge／post-merge verification | PENDING。審驗前 `main` 為 `2f880f9ae1e30fa3fff7e11261194873b8ccd2de`。 |
| 舊 stacked PRs | #1～#4 保留 Draft，等待整合後驗證。 |

## 實作及結果

- 已刪除 `Install-FYP-Demo-Shortcut.bat` 與 `scripts/windows/Install-DemoShortcut.ps1`，更新使用文件及 Launcher regression。保留 `Start-FYP-Demo.bat`、`Start-Platform.bat`、`Setup-Platform.bat`、`Stop-Platform.bat`、`Diagnose-Platform.bat` 和 `scripts/windows/Platform.ps1`。
- 新封存版從含 Unicode 和空格的資料夾直接執行 BAT，安裝鎖定 npm 套件、處理現有連接埠、驗證實際 Demo baseline 並請 Windows 開啟預設瀏覽器。Normal／Demo 使用獨立設定、Compose identity 和 volumes。重啟前後 PostgreSQL 資料及證據引用一致。既有 Desktop shortcut 清單未改。
- Job 只顯示後端確認的 parent Request。錯誤／過期提示，以及只出現在 Router state 的 ID，均無法建立顯示關聯。回程保留原 Request 的焦點及 query。
- 修正 Overview 欄首與 Data Explorer 共用 class 衝突，以及 Source Binding 小型連結的觸控區域。沿用 M11～M15 介面結構。GitHub workflow 增加 frontend build／TypeScript 及非破壞性的 Backend unit tests。

| 測試 | 結果 |
| --- | --- |
| Backend Core／PostgreSQL／Redis／Celery | PASS，270 項，0 失敗、0 跳過。 |
| Chrome Playwright | PASS，154 項 mocked regression、26 項實際 API cases。 |
| Windows PowerShell／真實 BAT | PASS，28/28 regression；隔離 Normal Setup／Start／Diagnose／Stop，Demo 重複啟動、停止、重啟及保留 volumes。 |
| Demo 資料／可及性 | PASS，三組 baseline、`detail404`、Article 版本、Evidence files 及兩種匯出。17 項實際畫面／視窗核對未發現 axe A／AA 問題或整頁水平溢出。 |
| 物理 8 GiB、真實 Docker Desktop cold start、實體螢幕閱讀器 | NOT RUN。另做 1,664 MiB 容器限制測試，並以既有 Docker Engine 做真實 Windows Shell 驗證。 |

[最終 MVP 驗收](docs/evaluation/M16-Final-MVP-Acceptance.md) 包含 audit、完整測試矩陣、可重現指令和證據位置。[Release Readiness](docs/evaluation/M16-Release-Readiness.md) 記錄 gates、資料保護及 rollback。展示從 [FYP Presentation Runbook](docs/evaluation/M16-FYP-Presentation-Runbook.md) 開始。

**建議 GO 進入獨立技術審閱。** M16-H 等獨立審閱確認 GO，再按 GitHub 實際 branch rules、CI 與正常 PR merge 流程完成。
