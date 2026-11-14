# M0 Readiness Review

**M1 建議為受控環境 GO，公開來源及 M0 正式結案仍有未完成項目。** Scrapling 已通過受控 HTML 和 loopback HTTP 的技術驗證。M1 可在受控來源實作 generic extraction、Profile validation／approval 及 CSV adapter 共用 ingestion。公開來源須另行通過存取授權、DNS／egress、robots 和 request safety 驗證。

## Definition of Done

| # | 驗收 | 結果與證據 |
| --- | --- | --- |
| 1 | Repository 和 prototype baseline | **部分完成**。工作區 baseline 及原型歷史文件已盤點。可核實的原始碼在指定範圍缺少。 |
| 2 | 執行可取得的既有測試 | **BLOCKED**。指定工作區未提供原型測試。 |
| 3 | 缺少的原型證據已記錄 | **PASS**。[Baseline](M0-baseline-report.md) |
| 4 | 開發環境與依賴已記錄 | **PASS**。Windows、鎖檔、imports、測量及 Docker 缺口見 [環境報告](M0-environment-report.md)。 |
| 5–8 | Parser、兩種 layouts、HTTP failures、redirects、headers 和 retries | **PASS**。36 項 Spike tests 通過。詳見 [實驗結果](M0-scrapling-spike.md)。 |
| 9 | Core 概念 contracts | **PASS**。[Core contracts](../contracts/M0-core-contracts.md) |
| 10–11 | ADR、待決定項目和 Proposal 差異 | **PASS**。差異已記錄，Supervisor／同儕確認仍待進行。[ADR](../decisions/M0-architecture-decisions.md) |
| 12 | GitHub Issues 和 Project 狀態 | **BLOCKED**。使用者確認尚未建立 FYP remote 和 Project。 |
| 13 | Feature branch commit | **PASS**。成果提交至本機 `feature/M0-core-foundation`，可用 `git show --stat HEAD` 審查。 |
| 14 | 可審查 PR 或本機變更摘要 | **PASS**。本文件、[README](../../README.md) 和本機 branch 提供 review 路徑。GitHub Draft PR 及第二位學生審查仍待進行。 |
| 15 | 有證據的 M1 判斷 | **PASS**。受控來源可進入 M1；公開來源的技術及授權驗收維持待辦。 |

## 待處理 GitHub 工作

| Issue | 本機狀態 | 驗收證據／阻塞 |
| --- | --- | --- |
| M0-01 Repository Baseline and Prototype Verification | Blocked | Baseline 已寫。缺少在指定範圍內的原型 source、依賴及測試。 |
| M0-02 Development Environment and Dependency Verification | In Review | Windows 安裝、imports 和 QA 通過。Docker／8 GB 尚無實測。 |
| M0-03 Scrapling Parser Technical Spike | In Review | 兩個 layouts、CSS／XPath、欄位及例外測試通過。 |
| M0-04 Scrapling HTTP Fetcher and Safety Spike | In Review | Loopback 實測通過。Production DNS／egress 待後續驗收。 |
| M0-05 Core Contracts and Architecture Decisions | In Review | 概念 contracts 及待決項目已記錄。 |
| M0-06 Architecture Freeze and M1 Readiness Review | In Review | ADR、Proposal 差異與 readiness 已記錄。待同儕 review 及正式提交。 |

目標可用後，核實 repository、default branch、PR／branch protection、Projects fields 和現有 Issues／milestones／labels。沿用既有設定，新增缺少的 M0 milestone 和六張 Issues，填寫 Objective、Scope、Tasks、Acceptance、Testing、Dependencies、Deliverables、Risks 及 DoD，將 Issues 指派給已核實的使用者並連接 Project。確認 remote base 後推送 feature branch，建立 Draft PR，按實際驗收更新狀態及安排第二位學生審查。

## 下一個 Codex 任務

在受控 HTML 和 CSV fixtures 建立 M1 vertical slice。涵蓋 Draft Profile 版本、Preview、Validation、人工批准與重用已批准設定，輸出可追溯 Generic Record candidates。測試未批准／被修改版本、缺失或無效欄位、重複輸入和 evidence lineage。獨立驗證可安全約束實際連線目的地的 HTTP wrapper，再考慮公開來源。
