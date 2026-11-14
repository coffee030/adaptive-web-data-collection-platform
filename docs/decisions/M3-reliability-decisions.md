# M3 Reliability Decisions

2026-11-14（香港時間）。依本次 M3 scope 實作，待同儕審查。

## ADR M3-01 Job row 保存派送意圖

每個 Job 只有一份受控輸入與一種 task。評估 Job fields 和 transactional Outbox table 後，選用 Job fields。Job 建立、dispatch intent 和 event 同時提交。Dispatcher 在有索引的 due rows 上逐筆以 `SKIP LOCKED` 協調並行。Redis publication 和 SQL commit 的落差以安全重派及 claim 冪等性處理。Outbox 適合未來同一 domain transaction 需發多種獨立訊息的情況。當前方案會在 Redis I/O 期間持有單一 Job 鎖，應保持短 socket timeout，並監測 queue backlog。

## ADR M3-02 固定 lease 與 attempt generation

每次 claim 遞增 generation，使用 PostgreSQL clock。結果 transaction 在持鎖期間核對 ownership 後才發布。採 90 秒 lease 配合 Linux 60 秒 hard limit，暫時省略 heartbeat renewals。相對於只依賴 late ack 或 worker-lost requeue，可處理 broker 遺失、before-claim crash 和已 claim 後硬終止。HTTP 外部行為可重複，成功發布由 SQL constraints 和 state transition 保護。

Migration 0005 加上 dispatch／lease 欄位、兩個 partial indexes、約束和事件 metadata。既有 pending Jobs 變為 due，終態保留，既有 running Jobs 變成已過期的 attempt 1。遷移前停止 M2 CLI／執行者，避免舊程序繞過 M3 ownership。0005 downgrade 會移除 M3 metadata，原有結果 tables 保留。

## ADR M3-03 共用 retry policy

應用層按 failure codes、HTTP status 和 Retry-After 判斷執行重試，PostgreSQL 管理 attempt budget。Dispatcher 派送、lease recovery 和 backoff 由同一 service 輪詢，Celery 僅負責 transport，Scrapling 保留單 request 一次嘗試。這套 policy 優先保留一份可追溯的 terminal evidence。過往 failed-attempt 檔案仍可由停機時的檔案／DB 比對查找。

## ADR M3-04 受控測試與 milestone scope

Compose fixture 明確 opt in，限固定 origin 且依賴 internal network。M2 的預設 loopback 規則及 Source 授權保留。按本次 brief，以 1 個 Worker 預設和 2 個 Worker 測試、多 worker claim 及 Job API 為驗收。Teammate implementation brief 的 4 Worker workload、fleet heartbeat 與統計是擴展驗證項目。M4 UI、公開站點 egress 和通用 rate-limiter 留待各自里程碑。
