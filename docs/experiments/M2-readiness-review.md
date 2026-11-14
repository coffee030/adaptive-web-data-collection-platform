# M2 Readiness Review

驗證日期為 2026-11-14（香港時間）。開發分支以 M1 commit `cd7c681` 為基線。

| Definition of Done | 狀態與證據 |
| --- | --- |
| M0／M1 regression | PASS。保留原有 112 項測試。 |
| 本機 PostgreSQL、空 schema、migrations 與 FK／UNIQUE | PASS。Windows 原生 PostgreSQL 17.7。測試為每個 case 建立空 schema 並遷移；獨立空資料庫亦完成升級。 |
| Source 及 Profile 重啟後保存 | PASS。兩個 Uvicorn 程序及 PostgreSQL 正常重啟後回讀並比對。 |
| Immutable approved Profile、stale Validation、並行審批 | PASS。Application rules、row lock、revision fence、rollback 及 SQL trigger 均有測試。 |
| FastAPI Source／Profile | PASS。驗證、審批、retire、錯誤 envelope 和 OpenAPI。 |
| Job 固定 Profile Version、持久化與狀態轉移 | PASS。可獨立執行，claim 只成功一次，拒絕未批准／retired profile，正常保存終態和 events。 |
| HTML／CSV 共用 M1 ingestion | PASS。兩條真實 DB vertical slices，Web 使用實際 loopback HTTP 與 Scrapling。 |
| Records、quarantine、evidence lineage、重複提交 | PASS。可從 REST 回讀，驗證 hash、缺檔、結果 rollback、資料庫關聯及跨 Source identity。 |
| API 停止並重啟／PostgreSQL 原生重啟 | PASS。實際 CLI 與不同 API PID；所有 metadata 和原始檔 hash 一致。 |
| Compose PostgreSQL named-volume restart | **待驗證**。已提供 Compose 及獨立 restart 測試入口。本機缺少 Docker CLI 和 WSL runtime。 |
| Ruff／migration schema check、M2 範圍與風險 | PASS。命令與結果記於測試報告。 |

## M3 判斷

**本機受控 M3 service 設計 GO。完整 M2 驗收及 M3 容器整合暫為 NO-GO。** 在 Docker 可用的 Linux／WSL2 環境重跑 dedicated volume restart，可關閉 M2 的剩餘驗收項目。

Job claim commit 後如遇程序崩潰或資料庫長時間離線，Job 可能停留在 `running`。M3 下一項 Codex 工作可先在 Docker 環境補足 M2 驗收，再以 ADR 定義 dispatch 一致性、可恢復的 lease／attempt、重複交付及 commit-before-ack 測試。M2 的 CLI 和 application services 已建立可重用執行入口。公開網站的 DNS／TLS／egress、production authentication、retention 與備份仍須分別驗證。審批的本機 operator 只供 audit。

本機 Issue Manifest 追蹤 M2-01 至 M2-08。Git 無 remote，GitHub Issues、Project 與 PR 尚未建立或更新，同儕 review 待安排。
