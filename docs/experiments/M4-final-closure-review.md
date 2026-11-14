# M4 Final Closure Review

**2026-11-14 現行決策：M4 技術修復獲接納，可進入 M5。** [授權與驗收範圍](#2026-11-14-使用者授權與驗收範圍更新)

**歷史 Final Gate 紀錄：M4 CLOSURE NO-GO / M5 NO-GO**

本機技術驗證以 `fix/M4-closure` 的 `439e1a2` 為基準，由 M4-E `081c5f3` 延伸。後續 closure 提交僅更新文件。本次由使用者個人驗收。仍待 Narrator、iPhone Safari、實體 8 GB Windows 的驗收紀錄或適用決定。M5 仍待使用者明確授權。

## Audit scope and result

| Milestone | Closure review |
| --- | --- |
| M4-A — Collection Jobs | 比對 M4-A 的驗收紀錄、狀態與 events DTO。核對 deterministic order、空尾頁、404、不合法時間 fallback 與 polling。 |
| M4-B — Sources | 檢視註冊、授權和 Profile 跳轉。PostgreSQL unique key、payload digest 和交易保護 Source 重送。保留既有 terminal authorization。 |
| M4-C — Profiles | Draft revision 比較在 server transaction 內；失效 write 409、未提供 revision 428、approved immutable、過期報告不能核准。實測兩個 browser tabs 和 reload recovery。 |
| M4-D — Records, Quarantine, Evidence | 核對 payload、實體列位置、各計數語意和 lineage。Evidence-only Job 直達 metadata，無 capture 時顯示空狀態，DTO 不含內部 storage reference。 |
| M4-E — Submission and demo | 真實資料庫與 Linux Celery prefork 跑 HTML 與 CSV、exact Profile pin、重播、失敗復原與 persistence。四種 viewport 複核畫面與 axe。 |

Defect chain、修復及測試見 [Issue ledger](M4-outstanding-issues.md)。各歷史 acceptance 的測試數字保留。實際演練步驟見 [Demo runbook](../demo/M4-core-demo-runbook.md)。

## Verified gates

- 檢查並補齊 Playwright 所需的官方 Windows binaries。環境狀態和 browser 版本見 [Environment readiness](M4-environment-readiness.md)。
- 已確認的 P0、in-scope P1／P2 均有修復及 regression。Source Authorization 和 Profile Approval 維持可信本機流程，`LOCAL_PROFILE_APPROVAL=1` 仍須明確開啟。核准標籤是自報資料。
- Full backend、Chromium controlled、live Docker、TypeScript、Vite、Ruff、Alembic 和各代表性跨瀏覽器流程通過。實測結果及未執行項目見 [Remediation test results](M4-remediation-test-results.md)。
- PostgreSQL 0006 migration 通過，隔離演練完成資料庫重啟及 Evidence 內容核對。受限 Compose 完成實際 jobs。Dispatcher 和 HTML fixture 的 shutdown signal 已校正並在隔離容器驗證。
- Git remediation commits 僅涵蓋本次範圍。本機分支含程式修改、合約及 runbook，可供使用者本機自查。

## Acceptance gates

| Gate | Status | Required action |
| --- | --- | --- |
| GitHub remote／PR | DEFERRED TO M5 | 本機 Git 交付。 |
| Teammate review | OUT OF SCOPE | 由使用者個人驗收。 [本機驗收清單](../reviews/M4-teammate-review-checklist.md) |
| Windows Narrator | NOT RUN | 使用者操作並記錄語音、焦點、錯誤、狀態及確認流程。 [Narrator procedure](../reviews/M4-narrator-acceptance.md) |
| macOS Safari | OUT OF SCOPE／NOT RUN | 使用者因無 Mac 移除該驗收條件。 |
| iPhone Safari／實體 8 GB Windows | NOT RUN | 使用者可分別實測，或明確記錄為接受的 MVP 限制。 [實機與資源](M4-device-and-resource-acceptance.md) |

## MVP boundaries

受控 HTML／CSV、可信 loopback 操作、自報 approver label。完整 production authentication 需另外決定範圍。Offset pagination 逐次取得 live rows，跨頁讀取可因插入與狀態變動而重疊或移位。來源超出許可規則時由 server 拒絕。Evidence UI 顯示儲存的 metadata；實際 bytes checksum 由隔離後端驗證。外部驗收條件仍依上述狀態處理。

## Final Gate decision

**M4 正式驗收待使用者決定。** 技術驗證保留，程式與測試仍和 `439e1a2` 一致。Firefox 原始崩潰保留，六次 Evidence 重跑均通過，根因未確定。 [測試證據](M4-remediation-test-results.md#final-gate-補充核對)

使用者完成 Narrator，並就 iPhone Safari 和實體 8 GB Windows 分別記錄實測或接受的未測限制後，再記錄 M4 正式驗收。**M5 NO-GO**，待使用者獨立授權。

## 2026-11-14 使用者授權與驗收範圍更新

- 使用者接納 M4 技術修復作為進入下一里程碑的依據，並明確授權 M5 Core Stabilization、Technical Evaluation 及 Release Candidate 開發。
- 上述 NO-GO 屬原 Final Gate 決策。歷史測試結果及執行紀錄維持原樣。
- 實際 iPhone／iOS Safari、macOS Safari、實體 8 GB Windows、個人裝置及自訂環境整合，以及需使用者參與的人工 screen-reader 驗收，皆延期至 M5 後，為 **DEFERRED / NOT RUN**。
- 正式組員覆核仍待獨立安排，已移出 M4 closure gate。
- 此授權適用於可信本機 Core MVP。Production readiness 未宣稱，M6／M7 開發仍待另外授權。
