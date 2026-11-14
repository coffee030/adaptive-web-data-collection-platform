# M4 Closure API Contract

本文件補充 M2、M4-C、M4-D 和 M4-E 合約。API 預設使用 loopback。

M5 維持此 REST 介面，並補充 terminal Job 消費方式、有效欄位和 lineage。HTML 入口拒絕含歧義的路徑片段，擷取結果的累計文字值限 1 MiB UTF-8。 [M5 Downstream Integration Contract](M5-downstream-integration-contract.md)

| Method / Path | 現行行為 |
| --- | --- |
| POST `/api/v1/sources` | JSON 可帶 UUID `request_key`。第一次建立回 201。相同 key 和正規化註冊資料回 200 及現行 Source。payload 不符回 409 `source_request_conflict`。升降 Source access 後的 replay 保留當前授權值。略過 key 時保留既有獨立註冊行為。 |
| GET／POST `/api/v1/sources/{source_id}/versions` 和 GET 單筆 | Profile payload 加上整數 `revision`，新 Draft 從 1 開始。 |
| PUT `/api/v1/sources/{source_id}/versions/{version_id}` | `{"configuration":{…},"expected_revision":1}`。在同一 DB transaction 內鎖定及比較。符合則寫入並遞增 revision。遺漏前置條件回 428 `draft_revision_required`，失效 revision 回 409 `draft_revision_conflict`，非 Draft 仍回 409 `profile_not_draft`。 |
| POST `…/validate`、`…/approve` | 仍基於已存 draft revision、最新 passing report、config hash 和 Source authorization。核准及退役 response 也含 revision。 |
| GET `/api/v1/collection-jobs/{job_id}/evidence` | 有 capture 回 Evidence Metadata，無 capture 回 200 `null`，Job 不存在回 404。 |
| GET `/api/v1/evidence/{evidence_id}` | 與 Job-scoped lookup 使用同一 DTO，省略內部 `storage_reference`。Raw files 仍由 backend storage 保存。 |

Alembic `0006` 新增 nullable request key、配對 hash 及唯一約束。歷史 Source 可原樣保留。成功重播回傳現行 Source 以保留較新授權狀態。React 對未獲確認的 Source／Job 寫入保留 request key。跨頁的同一 tab session 只保存 fingerprint 及 key，需重新提交相同的表單內容。

## Trusted-local boundary

FastAPI 驗證 loopback Host。若有 browser Origin，要求與實際 API scheme 和 Host 相同。Vite 轉送瀏覽器的 Host 並維持 opt-in、peer loopback、same-origin approval rules。Compose API 和 PostgreSQL host port 只發佈 127.0.0.1。原生 API 請明確綁定 loopback，可信終端可使用沒有 Origin 的直接 API。應用不新增 CORS allowlist。不要將此部署放在公共 reverse proxy，或讓不受信任的 container 接入其 Compose 網路。Approver label 屬自報 audit 資料。Host／Origin 邊界與本機部署沒有提供使用者身份或角色。

## Pagination and monitoring

Jobs、Records 和 Quarantine 使用 deterministic order 和 offset。Jobs／Records 依 `created_at, id`，Quarantine 依 `position_index, id`。API 維持 `limit` 1–100 和非負 offset。Source 全列表依 `created_at, id`，Versions 依 Source 內唯一 version number，兩者 browser page 可透過 URL 保留。不同讀取之間有插入或 Job 狀態更改時，offset page 的成員可能變動。空尾頁可回上一頁。無跨請求 snapshot。

Pending／Running Job 只在 visible detail page 於每輪完成後排程。終態、離頁、hidden tab 清理 timer。Active view 不預取結果。終態才讀 Records 和 Evidence，使用實際 Job 與 execution events。
