# M3 Issue Manifest

開發分支 `feature/M3-celery-reliable-execution`，基線 `2790cc3`。Git 未設定 remote，使用本機 manifest 追蹤。GitHub Issues、Project 和 PR 未建立。同儕審查待安排。

| Issue | 狀態 | 驗證／產出 |
| --- | --- | --- |
| M3-00 Environment and M2 Docker Verification | BLOCKED | 原生 134 項通過，PostgreSQL 17.7 正常重啟及 schema 0004 已確認。M2 Docker named-volume gate 等待 Docker Engine |
| M3-01 Redis and Celery Foundation | PASS | Redis 7.4.8 portable、Celery 5.6.3、Kombu 5.6.2、redis-py 5.2.1。真實 transport ping、registration 及錯誤回報 |
| M3-02 Worker / JobExecutor Integration | PASS | 真實 worker process 執行 M2 `JobExecutor`，HTML／CSV 回讀 |
| M3-03 Durable Dispatch | PASS | PostgreSQL Job row dispatch intent，真實 Redis 停止及重啟，publish-before-rollback 和並行派送 |
| M3-04 Job Lease and Recovery | PASS | 90 秒 lease，generation fence，實際 worker process kill 後復原。測試推進 lease 時間 |
| M3-05 Idempotency and Result Safety | PASS | Active／terminal duplicates、DB transaction rollback、commit-before-ack 的 broker redelivery |
| M3-06 Retry and Failure Classification | PASS | PostgreSQL 排程及上限，HTTP 429／500／timeout，access-blocked 結束 |
| M3-07 Execution Monitoring | PASS | Status filter、dispatch／attempt 欄位及 durable event kinds，舊 DTO 欄位保留 |
| M3-08 Docker End-to-End Verification | BLOCKED | Compose config 驗證通過。Linux build、prefork、容器重啟及 Docker 資源驗收等待可用 Engine |
