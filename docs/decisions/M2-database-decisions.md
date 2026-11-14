# M2 Database Decisions

2026-11-14（香港時間）。決定依 M2 brief 落實，待同儕審查。

## ADR M2-01 PostgreSQL 與 Core 邊界

**背景** M1 以記憶體管理 Source 和 Profile。M2 需要 durable state 及一致的審批。
**決定** 以 PostgreSQL 17、SQLAlchemy 2、psycopg 和 Alembic 實作。Application services 以 row locks 管理交易，透過 M1 snapshot 呼叫 lifecycle，ORM 和 migration 採獨立資料模型。
**替代方案** 將 ORM model 納入 Core，或採用 SQLite。
**後果** 可保留既有 M1 library 呼叫方式，需實測 PostgreSQL JSONB、鎖及 FK。Native Windows 可供本機驗證，Compose 以 Linux PostgreSQL 為標準開發配置，未來 API／CLI Linux 容器須共享 evidence volume 並重新驗證。

## ADR M2-02 Job 固定輸入與重送

**背景** M0 Task contract 需支援 queue redelivery，M2 僅執行一份受控輸入。
**決定** 以 Job row 作 durable claim，固定 profile version/hash，允許 client 為同一來源提供 request key。M1 first valid wins 維持每 Job；全資料庫可保存不同 Job 的歷史快照。
**替代方案** 採用 Job/Task/attempt 三層或全域 dedup。
**後果** CLI 可取代 transport trigger，同一 Job 只進入 running 一次。硬中止可留下 running Job；lease、recovery、retry 及可靠 queue dispatch 需在 M3 設計。

## ADR M2-03 Evidence 及結果發布

**背景** 原始 bytes 要保存於可核對的本機檔案，DB 必須追蹤 results 和 lineage。
**決定** 沿用 M1 staged evidence，重新核對 bytes/hash，之後以一個 DB transaction 發布 metadata、結果及終態。藉 composite FK 防止跨 Job evidence 引用。
**替代方案** 把 raw bytes 和 metadata 一併寫入 PostgreSQL，或以複雜補償交易刪檔。
**後果** DB 失敗可能留下孤兒檔；由操作者在停機時比對，避免自動清理與 in-flight publication 競爭。長期 retention 和 DB／filesystem 一致備份留待後續驗證。
