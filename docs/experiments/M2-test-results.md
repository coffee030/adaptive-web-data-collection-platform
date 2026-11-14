# M2 Verification Results

日期為 2026-11-14（香港時間）。環境為 Windows、CPython 3.12.14、原生 PostgreSQL 17.7（loopback 專用測試 instance）、Scrapling 0.5.1、Pydantic 2.14.3、SQLAlchemy 2.0.57、Alembic 1.20.1、psycopg 3.3.9、FastAPI 0.162.7、pytest 9.2.0 及 Ruff 0.17.5。測試使用明確設定的 `M2_TEST_DATABASE_URL`，依 case 建立隨機 schema。程序重啟另外使用 `M2_TEST_PG_CTL` 和 `M2_TEST_PGDATA`，指向獨立資料目錄。

## 基線及批次

| Batch | 命令／重點 | 觀察結果 |
| --- | --- | --- |
| M1 基線 `cd7c681` | `python -m pytest -q --tb=short backend/tests` | 預設 sandbox 阻止 loopback，69 PASS／43 FAIL。允許 loopback 後，同樣的測試 112 PASS。Ruff lint/format PASS。 |
| A | `python -m pytest -q --tb=short backend/tests`、`python -m alembic upgrade head`、`python -m alembic check` | 115 PASS。獨立空資料庫升至 0001；FK、唯一 constraint、並行建版和 hash round-trip PASS。 |
| B | 同上 | 122 PASS。0002；審批、回滾、stale revision、DB immutability、API 與 OpenAPI。修正 report DTO 的 forward reference 後以完整測試確認。 |
| C | `python -m pytest -q --tb=short backend/tests/m2`，Alembic upgrade/check | 15 PASS。0003；兩並行 claims 中只有一個成功；revoked Source 執行失敗；CSV mixed input 為 partial。 |
| D | 同上 | 20 PASS。0004；證據缺失及交易失敗阻止結果發布，跨 Job evidence FK 拒絕錯誤引用。 |
| E | `python -m pytest -q --tb=short backend/tests/m2/test_process_restart.py` | 1 PASS。Windows 初次 pg_ctl restart 後，子程序繼承輸出 pipe，令測試 timeout。將 server log 導向檔案、pg_ctl stdio 獨立處理後通過。 |

## 最終命令及結果

指令從 repository 根目錄使用 `.venv/Scripts/python.exe` 執行。Alembic CLI 驗證使用已申明的獨立測試 `DATABASE_URL`。

| 命令 | 結果 |
| --- | --- |
| `python -m pytest -q --tb=short backend/tests/test_m0_extraction.py backend/tests/test_m0_http.py` | 36 PASS |
| `python -m pytest -q --tb=short backend/tests/m1` | 76 PASS |
| `python -m pytest -q --tb=short backend/tests/m2` | 22 PASS |
| `python -m pytest -q --tb=short backend/tests` | 134 PASS |
| `python -m pip check` | PASS，無相依衝突 |
| `python -m ruff check backend` | PASS |
| `python -m ruff format --check backend` | PASS |
| `python -m alembic upgrade head` | PASS；0001 至 0004 在空庫／空測試 schema 可套用 |
| `python -m alembic current --check-heads` | PASS，`0004 (head)` |
| `python -m alembic check` | PASS，無 schema drift |
| `git diff --check cd7c681 HEAD` | PASS，M2 變更 |
| `git diff --check` | 提示既有 teammate brief 本機修改的檔尾空行；原檔保留 |
| `Get-Command docker -ErrorAction Stop` | 找不到 Docker CLI。Compose config、container startup／volume restart 未能執行。 |

## 實際資料流程

| Fixture | Job 結果 | Valid | Invalid | Duplicate | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| M0 HTML `table.html` | `succeeded` | 2 | 0 | 0 | Loopback HTTP，原始 bytes 與 SHA-256 相符 |
| M1 CSV `listings.csv` | `partial` | 2 | 3 | 1 | File fixture 的 UTF-8 bytes 與 SHA-256 相符 |

端到端以實際 FastAPI endpoints 建立 Source、Draft、Preview、Validation、Approval 及 Job。結果透過實際 JobExecutor、PostgreSQL 與 filesystem 發布，REST 讀回 counts、events、records、quarantine 和 evidence metadata。HTML 與 CSV 測試再建立新的 API instance 讀回資料。獨立程序測試另實際啟動 Uvicorn，透過 TCP REST 建立 CSV Job，以 `python -m backend.cli <job UUID>` 執行。停止 API，再以 `pg_ctl restart` 正常重啟 PostgreSQL 並保留 data directory，啟動不同 PID 的 Uvicorn 後比對六個已提交 API 回應及 evidence 檔。

Compose named volume 的專用測試入口為 `M2_TEST_COMPOSE_PROJECT`。須用已啟動且資料庫 URL 正確的專用 test project。完整容器驗證以該模式結果為準。
