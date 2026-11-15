# M6 Implementation Handoff Report

2026-11-16（香港時間）

## A. Repository Baseline

- 初始分支為 `feature/M5.5-dashboard-redesign`，commit `cb3972132282df820e7486dcbdf910360c84150c`。工作樹原有一項修改 `Adaptive_Web_Data_Collection_Platform_Teammate_Implementation_Instructions(1).md` 及一項刪除 `M5-Windows-Launcher-ChatGPT-Handoff.txt`，兩項均未納入 M6 commits。
- 審核涵蓋 `AGENTS.md`、專案 skills、README、PRODUCT、DESIGN、Proposal 的相關條目、M2／M3／M5 架構與 API 文件，以及現有 FastAPI、SQLAlchemy、Alembic、Redis、Celery、Scrapling、Evidence、Jobs 和瀏覽器測試。
- 沿用受控 HTML／CSV adapters、Source access 與 Profile Review、設定 hash pin、Generic Record validation／dedup、Evidence store、PostgreSQL claim／lease、Dispatcher、Celery、既有 React routes 與 Windows launcher。
- 原有 `uq_evidence_job` 和 `uq_evidence_run` 各自把 Evidence 限為單頁。原有 Quarantine uniqueness 也會使不同 HTML 頁的相同 item index 衝突。Profile hash 需要兼容既有核准版本。原有 SQL transaction fencing 適合一次發布完整 attempt，檔案與 DB 則有既存的跨系統 commit 間隔。
- 修改前在可存取臨時 localhost fixtures 的執行環境跑完整 backend suite，結果為 **135 passed，48 skipped**。48 項需 PostgreSQL、Redis 或 Compose 配置。第一次受限環境試跑出現 localhost connection failures，解除 fixture 執行限制後 baseline 通過。

## B. Implementation Summary

- `backend/core/contracts.py`、`runner.py`、`web_adapter.py` 加入核准版本內的可選 next-link 策略。上限 1–5 頁，單頁使用 CSS 或 XPath selector、同源檢查、visited URL set、robots 與有限 redirects。沒有 next link 結束遍歷，有未處理 next link 則回報 `page_limit_reached`。每頁 Evidence 保存 HTTP metadata、兩個 URL、頁次、hash 與既有 Source／Profile／run lineage。
- `backend/core/ingestion.py` 沿用 record identity 並在整個 attempt 共用 seen identities。每筆寫入的 Record／Quarantine 綁定自己的 Evidence。HTML 的 item index 屬於該頁。Job counts 加總所有已處理頁面。
- `backend/application/execution.py`、`backend/persistence/results.py` 沿用 PostgreSQL attempt fencing 及終態 transaction。暫時性 HTTP／連線錯誤按現有策略把整個 Job 重新由第一頁執行，最多三次。若重試耗盡且已有有效紀錄，終態為 `partial` 並保存停止原因。沒有有效紀錄則 `failed`。驗證失敗的候選保留於 Quarantine。
- 舊的單物件 `GET /api/v1/collection-jobs/{job_id}/evidence` 仍回傳第一頁或 `null`。新增排序清單 `/evidence-pages`，Evidence metadata 加上 `page_number`。Job submission、Record 與 Quarantine 的既有 lineage 欄位沿用。
- React Profile editor 增加兩個 HTML 專用設定，核准摘要顯示已鎖定值。Job Details 列出頁面，Evidence Metadata 顯示頁次。沿用原有頁面、元件、導航與設計。
- 詳細行為、升級與可操作 fixture 的步驟見 [M6 Controlled HTML Pagination](../contracts/M6-controlled-pagination.md)。

## C. Database Migration

- Alembic `0007_multi_page_evidence.py`，`down_revision = 0006`。新增 `raw_evidence.page_number`（既有資料預設 1）、`CHECK (page_number > 0)` 和 `UNIQUE (job_id, page_number)`。移除單列 `job_id`／`run_id` 的唯一限制，讓同一 attempt 的頁面共用 `run_id`。
- 保留 Evidence 的 `(job_id, id)`、Record 與 Quarantine 的 composite FK、Job 的 Profile pin、每 Job 的 Record dedup constraint。Quarantine unique key 增加 `evidence_id`，原有第 1 頁／CSV UUID 算法保留。
- 在 PostgreSQL 17 的 `0006` 測試 schema 寫入舊布局的 Job、Evidence、Record、Quarantine 與缺少頁次欄位的 sidecar，再執行 `upgrade head` 與 `alembic check`。升級後逐項核對原有 UUID、來源參照、Profile、hash、raw bytes 和頁次預設值。獨立 Compose DB 也完成由空庫至 `0007 (head)` 的 migration。
- 回退 DDL 會重建舊唯一限制，已有多頁資料時 PostgreSQL 會原子回滾 downgrade。M5.5 應以導入多頁功能前的 DB 和 Evidence volume 備份做版本回退。

## D. Testing Evidence

| 實際命令 | 結果 |
| --- | --- |
| `.\.venv\Scripts\python.exe -m pytest -q -rs --tb=short backend/tests` | 修改前 135 passed，48 skipped |
| `.\.venv\Scripts\python.exe -m pytest -q --tb=short backend/tests/m1/test_m6_pagination.py backend/tests/m2/test_m6_results.py backend/tests/m2/test_vertical_slice.py backend/tests/m2/test_result_failures.py` | 21 passed。包括 3 頁、乾淨結束、page limit、URL loop、redirect、429、500、timeout、舊資料升級、later-page 503 重試及 M5.5 HTTP／CSV 回歸 |
| `.\.venv\Scripts\python.exe -m pytest -q -rs -s --tb=short backend/tests` | 199 passed，1 failed，無 skip。唯一失敗是新 Compose 測試將相同的 Profile UUID 以有／無連字號的字串比較 |
| `.\.venv\Scripts\python.exe -m pytest -q -rs -s --tb=short backend/tests/m2/test_m3_compose.py -k multi_page` | 修正 UUID assertion 後，1 passed，2 deselected，103.00 秒。實測 worker SIGKILL、lease recovery、duplicate delivery、PostgreSQL／API restart 及兩個容器的 raw Evidence |
| `.\.venv\Scripts\python.exe -m ruff check backend`、`.\.venv\Scripts\python.exe -m ruff format --check backend` | 全數通過 |
| `npm.cmd test`（`frontend/`，`PLAYWRIGHT_CHANNEL=chrome`、`M4_FRONTEND_PORT=5195`） | 86 passed |
| `npm.cmd run typecheck`、`npm.cmd run build`（`frontend/`） | 皆通過，包含 M6 browser test 的 TypeScript |
| `npm.cmd test -- tests/core-workflow.integration.ts --workers=1`（`frontend/`，`PLAYWRIGHT_CHANNEL=chrome`、`M4_FRONTEND_PORT=5194`、`M4_REAL_API=1`、`LOCAL_PROFILE_APPROVAL=1`、`API_PROXY_TARGET=http://127.0.0.1:18006`） | 4 passed，包含真實 M6 HTML、單頁 HTML、CSV 及拒絕未核准的 Job |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/Test-Launcher.ps1` | 23/23 launcher tests passed |
| `git diff --check cb39721 HEAD` | M6 commits 的 whitespace 檢查通過。全工作樹檢查可見原有隊友文件的 trailing blank line |

Backend 使用 `M2_TEST_DATABASE_URL` 指向隔離 PostgreSQL (`127.0.0.1:55436`)，`M3_TEST_BROKER_URL=redis://127.0.0.1:16386/1`，`M3_TEST_COMPOSE_PROJECT` 與 `M2_TEST_COMPOSE_PROJECT` 為 `collection-m3-test-m6-a6c43b`，`M3_TEST_COMPOSE_API_URL=http://127.0.0.1:18006`。額外的 `-f` overlays 透過 `M3_TEST_COMPOSE_EXTRA_ARGS` 傳入。端對端執行期設定見下一節。

修正後重新執行的項目包括測試 fixture 的 `register_source` 回傳值、PostgreSQL retry test 的 TestClient loopback base URL、Evidence store subclass 相容性，以及 Compose test 的 Profile UUID 比對。首次 Playwright 啟動缺少預設 Chromium binary，切換已安裝 Chrome 後通過。首次 live browser run 遇上 API host port 綁定失敗，改用可用的 loopback port 後通過。

## E. Actual Runtime Verification

- 使用 Docker Desktop Linux Engine 29.9.3、Compose 5.7.0 及 repo `Dockerfile`。在隔離 project 執行 `docker compose @composeArgs config --quiet`、`docker compose @composeArgs up -d --wait postgres redis`、`docker compose @composeArgs build api`、`docker compose @composeArgs run --rm api python -m alembic upgrade head`、`docker compose @composeArgs run --rm api python -m alembic current --check-heads`、`docker compose @composeArgs up -d --wait`。`curl.exe --retry 8 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:18006/api/v1/health` 回傳 `{"status":"ok"}`。
- `$composeArgs` 使用 `-p collection-m3-test-m6-a6c43b -f compose.yaml -f compose.fixture.yaml -f .local/m6-compose.image.yaml -f scripts/windows/compose.subnet.yaml -f scripts/windows/compose.fixture-subnet.yaml`。本機 overlay 使用專用 `collection-backend:m6-a6c43b` image 及 loopback Redis test port。由於 Docker 預設 address pools 已用完，沿用 repo 的 subnet overlays 和已核對可用的 `10.249.111.0/24`、`10.249.112.0/24`。原 API port `58006` 被 Windows 拒絕，隔離測試改用 `18006`。
- 真實 browser Job `9d3ea0d0-d827-4b9c-8813-603981ef2738` 經 Chrome、Vite proxy、FastAPI、Dispatcher、Redis、Celery 和 PostgreSQL 完成 3 頁 HTTP collection。Job 終態 `partial`，3 個有效紀錄、2 個無效紀錄、1 個 duplicate。使用 UI 建立 Profile、Preview、Validate、Approve 和 Submit，並在 Job Details 開啟 Page 3 Evidence 和 Quarantine，核對 URL、hash 與 page-specific links。`Alpha`、`Beta`、`Gamma` 分別參照第 1、2、3 頁，兩筆 Quarantine 同為 item 2，分別參照第 2、3 頁。
- 同一次 Chrome session 的單頁 HTML Job `a6eefe3a-823e-4ca3-ac11-737e35cb9cb3` 為 `succeeded`（2 valid），CSV Job `3987a61a-5147-4b64-b163-b363c92363dc` 為 `partial`（2 valid、3 invalid、1 duplicate）。
- 另以 `.\.venv\Scripts\python.exe -` 執行 inline HTTP smoke check，沿用 `create_approved_source`／`submit_job` 對同一 API 提交 XPath Profile。將 item selector 設為 `//article[h2[normalize-space()]]`、field selector 設為 `./h2`、next-link selector 設為 `//a[@class='next']`。Job `729be76a-f8b0-4c3f-a34f-ed276835ba0d` 在 attempt 1 遍歷 3 頁，終態 `succeeded`，3 valid、0 invalid、1 duplicate，`error=null`。
- Compose Job `f4ff85c3-fb1f-4b0a-802f-d4e5f4252cf4` 在第一次 attempt 已取得頁面並等待 SQL 鎖時遭 worker SIGKILL。90 秒 lease 到期後由 Dispatcher 復原。Attempt 2 一次提交 3 個 Evidence、3 筆 Records、2 筆 Quarantine 及 1 筆 duplicate，只有一個 `PARTIAL` 終態事件。Redis 重送被 worker 判為 `job_not_pending`，結果與 events snapshot 相同。PostgreSQL、API 隨後重啟，全部 API snapshot、3 個 SHA-256、API 與 worker 容器所讀的 raw bytes 均一致。
- 驗收後以 `docker compose @composeArgs stop` 停止隔離 project，並以 `docker compose @composeArgs ps --status running --quiet` 確認服務已停止。PostgreSQL、Redis 與 Evidence named volumes 均保留。

## F. Known Issues and Limitations

- Retry 從第一頁重新請求，各次 attempt 或遇到網站內容改動時可能看見不同 bytes。完成 attempt 的 SQL batch 只發布一次。Worker 強制終止或 DB rollback 可留下未被 SQL 引用的 Evidence dirs，filesystem rename 與 PostgreSQL commit 之間沒有跨系統 transaction。
- Preview／Validate 只取樣一頁。整個 link chain 於 Job runtime 驗證。沒有 HTTP response 的 timeout 會有 Job error，無該頁 raw capture。處理上限遵守 60 秒 worker hard limit 和 90 秒 lease。尚未執行極限頁重負載的效能量測。
- M6 使用受控 next-link traversal。公開 HTTPS、Topic／Keyword Search、Search-to-Detail、Article Identity、Observation History、排程、AI／Sentiment 和 IA／KOL 未進入此 implementation scope。
- 獨立 Windows 測試驗證 launcher 邏輯，實際部署 walkthrough 使用 Compose 和 Vite。未執行另一台 8 GB Windows 電腦的冷安裝或手動輔助技術驗收。

## G. Git Status

- Local branch `feature/M6-multi-page-evidence`。
- `ff87fd4cebe9b5831ed7d1a416448dd24ff1e9a0` — Collect controlled HTML pages with page-level evidence。
- `1af3200fa6552ecc3ab5e97433f8f328223d4537` — Configure pagination and inspect page evidence in the dashboard。
- `0b6dbe221d8e65d1a8449ce4af7d9474efc5821e` — Compare profile pin UUIDs in the live recovery test。
- 工作樹保留 A 節列出的兩項原有修改。原 M5.5 分支仍指向初始 commit。未修改或合併 `main`，未部署。
- 使用者明確授權後，透過 GitHub connector 發布 `feature/M6-multi-page-evidence` 並開啟 [Draft PR #1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1)。遠端以 `main` 的 `2f880f9ae1e30fa3fff7e11261194873b8ccd2de` 為基準，本機 M5.5 commit 不在遠端歷史中。發布前核對 35 個基礎檔案及主要依賴的 blob，內容一致。四個 M6 提交在遠端依序為 `7eea6cc`、`acb9d86`、`fa8fa3b`、`d22a5a1`，建立 PR 前比對 32 個變更檔案，內容與本機 M6 提交一致。

## H. Acceptance Checklist

| 條件 | 狀態 | 實際證據 |
| --- | --- | --- |
| M5.5 Core、Dashboard 和 launcher 回歸 | PASS | Live HTML／CSV、86 項 Chrome 測試、23 項 launcher 測試 |
| 一個 Job 遍歷至少三個受控 HTML 頁面 | PASS | Browser Job `9d3ea0d0-d827-4b9c-8813-603981ef2738`，3 個 Evidence objects |
| Page limit、URL loop 與 authorized-origin／redirect 控制 | PASS | HTTP fixture 驗證下一頁未發送、fragment／encoding alias、跨源目標、redirect loop 及相對 URL |
| Accepted Record 正確連回各頁 | PASS | 3 筆 Records 參照不同的 Page 1–3 Evidence |
| Quarantine 正確連回各頁 | PASS | Page 2 和 Page 3 各有 item 2，Evidence 及 Quarantine ID 各異 |
| 從原有 schema 以 migration 升級 | PASS | PostgreSQL 17 執行 `0006 → 0007`，並核對舊結果關係、raw bytes 和 SHA-256 |
| HTTP timeout、429、5xx、partial 和 retry | PASS | Loopback HTTP fixtures 與 PostgreSQL retry exhaustion／recovery 測試 |
| Worker interruption 與 duplicate execution | PASS | 真實 prefork worker 在等待 SQL 鎖時被 kill，Job 於 attempt 2 復原，終態後 Redis 重送沒有新增資料 |
| API 兼容與 PostgreSQL 重啟後持久性 | PASS | 舊單物件 Evidence API 回傳 Page 1，重啟後核對全部 M6 snapshot、Evidence SHA-256 和原始檔 |
| 實際 Compose 與瀏覽器 walkthrough | PASS | API health、Chrome Profile→Job→Evidence workflow |
| M6 scope 與技術限制 | PASS | 合約、測試與本報告，未修改 M7–M10 功能 |
| Draft PR 發布（有條件的交付項） | PASS | GitHub 確認 [PR #1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1) 為 open draft，目標為 `main` |

## I. Recommendation

M6 已達本機功能驗收門檻，可由 ChatGPT 或隊友從 [Draft PR #1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1) 進行獨立審查。M7 待 M6 審查及使用者核准。
