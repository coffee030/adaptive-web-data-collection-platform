# M5 Readiness Review

## M5 技術判斷

**M5 CORE RC GO**，適用於可信本機、受控資料的 Core MVP。

使用者於 2026-11-14 授權進入 M5，接受 M4 技術修復作為起點。原 Final Gate NO-GO 和歷史測試維持紀錄。 [M4 決策](M4-final-closure-review.md#2026-11-14-使用者授權與驗收範圍更新)

| Criterion | 核對證據 |
| --- | --- |
| Scope／Architecture | 現有 Modular Monolith、PostgreSQL、Redis/Celery、Scrapling 和 React 沿用；新增現狀 Mermaid 圖、原 Proposal FR/NFR gap matrix。 [Architecture](../architecture/M5-core-architecture-review.md) · [Matrix](../architecture/M5-core-capability-matrix.md) |
| Security and reliability | 修正 robots path mismatch、URL log exposure 和 HTML text amplification；Draft concurrency、Source／Job replay、approved version immutability、bounded execution retry、worker kill／Redis／DB outage 通過。 [Test Results](M5-test-results.md) |
| Integrity | HTML 2／0／0、CSV 2／3／1，Quarantine 位置及類別明確；實際 raw bytes、SHA-256、job/profile/source lineage 和 restart snapshots 已核對。 [Evaluation](../evaluation/M5-core-evaluation-results.md) |
| Deployment and demonstration | 全新 isolated Compose、Alembic 0006、Linux prefork Worker、Vite build 與 Browser workflow；safe stop、named volumes、restart 資料一致。 [Runbook](../demo/M5-core-demo-runbook.md) |
| Downstream | M6／M7 可依 Job ID、approved pin、validated Generic Records、Quarantine、Evidence metadata 與 source position 讀取。 [Contract](../contracts/M5-downstream-integration-contract.md) |
| Final gate | 182 backend、78 Chromium controlled、14 Chromium live、Firefox／WebKit 各 6 live＋2 focused polling。TS/build、Ruff、Alembic、56 live axe scans、Impeccable source／44 renders 通過。 [Test Results](M5-test-results.md) |

## 交接狀態與剩餘限制

正式 human code review 為 pending，安排在本機技術驗收之外。現時 repository 無 remote。若要接駁 private GitHub，需使用者確認 owner／organization、private repo 名稱、帳戶／寫入權限和 connect/publish/push 授權。現有 feature branch 可先用本機 Git 作覆核。

本機 RC 版本名稱為 `core-mvp-rc1`。交接檔位於 repository 外層，沿用 M4 Final Gate 的 handoff 位置。原有組員指引末尾空白行屬使用者工作區修改，獨立於 RC commit。

技術範圍為 trusted-local、受控 HTML/CSV、at-least-once queue delivery、fenced commit。本次有界 workload 的 2-worker 吞吐約為 1-worker 的 1.02×，Proposal 1.5× 目標在該負載未達，internet-scale 尚未驗證。公開 crawling、production auth、動態 browser collection、raw Evidence HTTP bytes、全域 snapshot pagination 及 M6／M7 domain 邏輯均在現有 Core 合約之外。Evidence retention、dispatch history growth 及 backup 屬已知維護限制。

實際 iPhone／iOS Safari、macOS Safari、實體 8 GB Windows、個人裝置／整合及手動 screen reader 為 **DEFERRED / NOT RUN**。這些項目依使用者決定獨立處理。 [Post-M5 checklist](Post-M5-device-acceptance-checklist.md)

## 歷史 M4-E 判斷

**GO for M5 planning and a local Core MVP demonstration.** M4-E browser acceptance 覆蓋受控 HTML、CSV、拒絕授權、不確定提交的重試，以及 PostgreSQL 和 FastAPI 重啟。合併前安排組員實際覆核。M5 的新實作尚未開始。 [M4-E acceptance](M4-E-acceptance.md)

## Teammate checklist

組員覆核狀態為 **NOT RUN**。Reviewer 可在同一個隔離 Compose project 重現操作。 [Demo runbook](../demo/M4-core-demo-runbook.md)

- [ ] 確認 Job form 重用既有 React Router、API client、Source Policy 和 UI patterns。
- [ ] 檢查實際 201／200／403／409／422 行為，及持久化的 Job 與 Profile pin。
- [ ] 確認 Source authorization 經可信 backend 操作。Profile Approval 只在明確啟用的 loopback demo 使用。
- [ ] 重現 Preview、Validation、stale report 拒絕及 immutable Approved Profile。
- [ ] 觀察 pending／running Job 更新，核對 terminal status、events 和三組結果 counts。
- [ ] 重現 HTML 及 CSV 追溯，包括 CSV 第 5、6、7 行與 Evidence Metadata。
- [ ] 檢查 API 停止及恢復時的 Retry、同一 key 及資料一致性。
- [ ] 檢查 390px Job form、鍵盤焦點、水平捲動和紀錄；核對測試證據及限制。

Production 上線仍需設計身份、權限、部署與安全邊界。M4-E 驗證對象是可信本機操作者、受控 fixtures 和現有 M3 架構。現有 at-least-once execution 和 backend-side Evidence 驗證語意適用。
