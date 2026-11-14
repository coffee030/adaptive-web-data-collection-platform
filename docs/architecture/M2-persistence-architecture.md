# M2 Persistence Architecture

M2 架構及原始 migrations 以本文件記錄。M4 Closure 沿用 Source row lock 並加入強制 Draft expected revision，新增 0006 Source request key／payload digest，且允許由 Job 查詢 Evidence metadata。參見 [M4 Closure API Contract](../contracts/M4-closure-api-contract.md)。

FastAPI 在 `backend/api` 接收請求，`backend/application` 建立 use-case transaction，`backend/persistence` 負責 ORM 與 PostgreSQL。獨立 `backend.cli` 呼叫同一 `JobExecutor`。M1 `CollectionRunner`、Scrapling／CSV adapters、`ingest()`、canonical hash 及 `LocalEvidenceStore` 持續由 `backend/core` 提供。

| Migration | Table | 關係及資料 |
| --- | --- | --- |
| 0001 | `sources` | UUID、adapter、授權、permission reference、JSONB input policy |
| 0001 | `profile_versions` | Source FK；`(source_id, version)` 唯一；JSONB config、schema、hash、draft revision、approval audit |
| 0002 | `profile_validation_reports` | Profile FK；revision、hash、sequence、UTC 時間及 JSONB 診斷；審批以 composite FK 指向同版本、同 hash report |
| 0003 | `collection_jobs` | Composite FK 固定 Source、Profile Version、config hash；狀態、counts、時間、輸入 hash、可選 request key |
| 0003 | `execution_events` | Job FK；按 sequence 查狀態和錯誤 |
| 0004 | `raw_evidence` | 每 Job 一筆、每 Run 唯一；capture metadata、原始資料 SHA-256、相對 storage reference |
| 0004 | `generic_records` | Composite FK 指向同 Job 的 evidence；JSONB payload 和位置；`(job_id, deduplication_key)` 唯一 |
| 0004 | `quarantined_records` | Composite FK 指向同 Job 的 evidence；每位置一筆，含 JSONB problems |

Core 字串 Source ID 在 M2 由 UUID 產生，SQL 欄位 `id` 映射到各 domain ID。Core `GenericRecord.record_id` 是 SHA-256 identity，M2 原樣保存為 `deduplication_key`，REST `record_id` 是以 Job UUID 與該 key 推導的 UUIDv5。Source、版本、hash 與 run lineage 由 FK join 取回。資料庫時間為 `timestamptz` 並使用 UTC 連線。M2 每 Job 一份輸入，Job 均對應一個 M1 Run；`run_id` 保存於 evidence metadata，未取得 evidence 的執行由 Job 與事件追蹤。M1 `completed` 映射到 M2 `succeeded`。

Profile mutation 依 Source row `FOR UPDATE` 序列化。同一 Source 的 create、edit、批准、退役、授權變更及 Job 建立，共用此鎖順序。M1 repository 可讀取 transaction-scoped snapshot，沿用原有 approval 規則。Preview／Validation I/O 在 transaction 外執行。Validation 發布時重新鎖定 Source，確認 Draft revision 與授權，使用原有 report/hash 驗證，再插入 report。即使設定改回原 hash，舊 revision 的 report 仍然失效。最新 report 以寫入 sequence 決定。批准檢查呼叫者提供的 hash、Source 授權、當前 passing report 和 operator 後一次 commit。DB trigger 保護已批准的設定、識別及審批資料，允許 approved → retired。

Job claim 鎖 Job row，提交 `running` 與事件後才執行。Runner 重查版本狀態及 Source 授權，Web 在 robots 及每一跳前讀取最新授權。退役後尚未開始的 Job 執行會失敗；已進入 Runner 的工作可完成。完成時重鎖 Job，核對 finalized evidence，寫入 evidence metadata、records、quarantine、counts 與 terminal event，再一起 commit。若資料庫結果提交失敗，rollback 會撤回所有結果，執行端嘗試另外記錄失敗。正常終態清除 Job 的暫存輸入 JSONB，保留 hash 與 request key。

`LocalEvidenceStore` 在同一 filesystem 以 staging 目錄和 rename 發布檔案。驗證時讀回 metadata 與 bytes 計算 SHA-256，通過才發布 DB metadata。Filesystem 與 DB 有各自的 commit 邊界。當 DB 回滾或程序中止，可能留下無 DB row 的檔案。停掉所有執行者後，可將 evidence root 中的 32 位 hex UUID 目錄與 `raw_evidence.id` 對照，核實未被引用後再處理。若 DB 暫時不可用或結果未確認，保留原始檔供調查。
