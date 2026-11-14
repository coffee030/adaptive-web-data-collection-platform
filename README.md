# Adaptive Scalable and Observable Web Data Collection Platform

Higher Diploma Final Year Project。已授權的本機 HTML 和 CSV 經 Profile Preview、Validation、顯式 Approval 後，可產出 Generic Records、結構化錯誤和可核對的 raw evidence。

## Quick Start — Windows 11

在本機 checkout 雙擊 `Start-Platform.bat`。首次啟動會檢查 Windows、WSL 2、Docker Desktop、Node.js 和鎖定的 frontend 套件。平台就緒後會開啟 [Overview](http://127.0.0.1:5197/)。

- `Setup-Platform.bat` 檢查及修復環境。
- `Stop-Platform.bat` 停止 launcher 的服務並保留資料。
- `Diagnose-Platform.bat` 產生診斷紀錄，最近一份在 `logs/launcher/latest.log`。

安裝權限、獨立資料卷及疑難排解見 [Windows 一鍵安裝指南](docs/setup/Windows-One-Click-Setup.md)。手動演示和 M5 全量驗收見 [M5 Demo Runbook](docs/demo/M5-core-demo-runbook.md)。

## M5.5 Dashboard

從 **Overview** 開始，選 **New Collection** 依次揀選 Topic、已授權 Source 和 Approved Profile。完成後可在 **Data Explorer** 查閱已驗證紀錄、Job 的品質統計及 Evidence Metadata。主題可用 **Theme** 切換。

- [受控 HTML／CSV 示範](docs/demo/M5.5-dashboard-demo-runbook.md)
- [Dashboard API 審核](docs/architecture/M5.5-dashboard-api-audit.md) · [主題與設計系統](DESIGN.md)

## M5 Core MVP

以受控 HTML 和 CSV 驗證同一套 collection、validation、dedup、recovery 及 provenance pipeline。Docker Compose 運行 PostgreSQL、Redis、FastAPI、Dispatcher、Linux Celery Worker 和獨立 fixture。React Console 以 loopback Vite 運行。

- [M5 Demo 與部署 Runbook](docs/demo/M5-core-demo-runbook.md) · [技術驗收狀態](docs/experiments/M5-readiness-review.md)
- [現行架構](docs/architecture/M5-core-architecture-review.md) · [Proposal 能力差距](docs/architecture/M5-core-capability-matrix.md)
- [量測方法](docs/evaluation/M5-core-evaluation-plan.md) · [實際結果](docs/evaluation/M5-core-evaluation-results.md) · [回歸測試](docs/experiments/M5-test-results.md)
- [M6／M7 REST 讀取合約](docs/contracts/M5-downstream-integration-contract.md) · [M4 Closure 與授權紀錄](docs/experiments/M4-final-closure-review.md)
- [Post-M5 實機及人工讀屏驗收](docs/experiments/Post-M5-device-acceptance-checklist.md)

Core 的使用邊界為可信本機 operator、受控 input 及明確 Approved Profile。Queue 採 at-least-once delivery，PostgreSQL 以 lease 和 attempt fencing 保護已提交結果。Browser 可讀 Evidence metadata，原始檔由後端 volume 管理。Live offset pagination 可能隨資料更新移位。Production authentication、public crawling 和 downstream domain features 需另外授權。

## M4-E Core Console Demo

從 **Collection Jobs** 選 **New Collection Job**，或從已核准的 Source／Profile 開啟同一個表單。選擇已批准的 Profile Version，輸入受控 HTML document path 或允許 dataset 的 UTF-8 CSV。FastAPI 確認提交後會開啟 **Job Details**。Pending／Running 時，頁面可見即定期讀取狀態和 events；亦可按 **Refresh job**。

使用隔離 Compose 的完整重現步驟見 [Core MVP Demo Runbook](docs/demo/M4-core-demo-runbook.md)。測試環境、命令及結果見 [M4-E Acceptance](docs/experiments/M4-E-acceptance.md)。

## M4-D Records、Quarantine 與 Evidence

- **Records**（`/records`）列出已持久化的 Generic Records。可按 **Job ID** 查詢。分頁和篩選寫入 URL，從 Record Details 用 **Back to Records** 可回到原有結果頁。
- **Record Details**（`/records/:recordId`）顯示 validation status、輸入位置、可分段瀏覽及複製的 JSON、Collection Job、Source、固定的 Profile Version 及 Evidence Metadata。
- 從 **Job Details** 選 **View quarantine**（`/collection-jobs/:jobId/quarantine`），可查看欄位與 validation problem。CSV 使用 candidate 的起始實體行號，HTML 使用從 1 開始的擷取項次。Job 的 **Valid**、**Invalid**、**Duplicates** 分別取自 API。
- 從 Record 或 Quarantine 的 Evidence ID 開啟 **Evidence Metadata**（`/evidence/:evidenceId`）。頁面顯示 backend 保存的 SHA-256 和 capture metadata。原始 bytes 的 checksum 可透過 backend store 驗證。Evidence 沒有下載或全域清單 API。

從 `frontend/` 執行 `npm.cmd test` 跑 controlled tests。使用下方 M3 隔離 Compose 環境時，設定 `M4_REAL_API=1`、`LOCAL_PROFILE_APPROVAL=1`、`API_PROXY_TARGET`，再執行 `npm.cmd test -- tests/results.integration.ts`。此 suite 建立自己的受控 HTML 和 CSV Jobs。設定 `M4D_COMPOSE_PROJECT` 可加入該測試 project 的 API／PostgreSQL 重啟與故障復原驗證。整套 live tests 請先準備既有 Jobs 和 Sources suites 所需的資料，並使用 `npm.cmd test -- --workers=1`，讓服務重啟案例獨立執行。

[M4-D API Contract Matrix](docs/contracts/M4-D-results-api-matrix.md) · [M4-D Acceptance Report](docs/experiments/M4-D-acceptance.md)

## M4-C Source Profile Lifecycle

從 **Sources → Source details → Profile versions** 開啟 **Create draft**。依 Source adapter 填寫 HTML selectors 或 CSV header mapping，設定 Record Schema 後儲存。Source access 已獲核准時，可使用 allowlist 上的 origin 或 dataset 測試。Preview 顯示最多五筆 candidates。要進入 Approval Review，須另行執行 **Validate sample** 並取得通過的報告。Approved 與 Retired 版本可由版本清單開啟唯讀配置。

受控本機 demo 須在可信操作者的電腦運行。使用 Docker Compose 預設的 loopback API 發佈方式，或將原生 FastAPI 綁定 `127.0.0.1`。在 `frontend/` 執行：

```powershell
$env:API_PROXY_TARGET = 'http://127.0.0.1:58000'
$env:LOCAL_PROFILE_APPROVAL = '1'
npm.cmd run dev
```

以 `http://127.0.0.1:5173` 開啟。核准操作需要填寫自報的 approver label 並勾選確認。Production build 和 Vite preview 停用此核准流程。FastAPI 的直接存取仍依賴可信的本機部署，Production authentication 尚未提供。

整套 live tests 使用 `M4_REAL_API=1` 和 `LOCAL_PROFILE_APPROVAL=1`。請指向已備妥 Jobs/Sources 測試資料的隔離 Compose fixture API。Profile tests 會建立額外受控 Sources 和 Versions。完整命令、結果與並行修改限制見 [M4-C Acceptance Report](docs/experiments/M4-C-acceptance.md)。

## M4-B Sources 管理

啟動下方的 Vite development server 後，從 sidebar 開啟 **Sources**。選擇 **Create source**，填寫名稱及 permission reference，按 adapter 輸入每行一筆的 dataset ID 或受控 origin（例如 `http://127.0.0.1:8001`）。新 Source 的 access authorization 為 **Pending**。授權由可信操作者經既有 backend workflow 處理。Source 詳情可查看 allowed inputs 及唯讀 Profile Versions，核准時間使用 UTC。

`M4_REAL_API=1` 會執行完整 live suite。使用隔離的測試 API，啟用 `LOCAL_PROFILE_APPROVAL=1`，並以 `npm.cmd test -- --workers=1` 依序執行。Sources live test 自行建立已核准的 CSV fixture 及 pending Source。單獨執行 Jobs live test 時，先依 Demo Runbook 建立一個 partial CSV Job。驗收命令與結果見 [M4-B Acceptance Report](docs/experiments/M4-B-acceptance.md)。

## M4-A Collection Jobs 控制台

需要 Node.js 20.19+（20.x）或 22.12+，以及隨 Node.js 安裝的 npm。先按下方 M3 步驟啟動已完成 migration 的 FastAPI 和 PostgreSQL。若要產生新的 Jobs 和結果，同時啟動 Redis、Dispatcher 及 Worker。

```powershell
curl.exe -fsS http://127.0.0.1:8000/api/v1/health
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

開啟 [Collection Jobs](http://127.0.0.1:5173/collection-jobs)。清單可按狀態篩選，詳情提供 UTC 時間、固定的 Profile Version、執行事件及相關紀錄預覽。用 **Refresh job** 重新讀取狀態和結果。

Vite 的 development 和 preview server 會把同源 `/api/v1` 轉送到 `http://127.0.0.1:8000`。若 M3 的 `API_PORT` 有改動，複製 `frontend/.env.example` 至 `frontend/.env.local`，並更新 `API_PROXY_TARGET`。部署 `dist/` 時，為前端路由設定 SPA fallback（例如直接開啟 `/collection-jobs/{job_id}`），並將 `/api/v1` 轉送至 FastAPI。如已有獲准的跨來源設定，可在 build 前設定 `VITE_API_BASE_URL`，值須包含版本路徑。這是公開的瀏覽器設定。M4-A 沿用現有 FastAPI CORS 設定。

在 `frontend/` 執行測試和 build。Playwright 測試會啟動 Vite，預設使用 port 5173，執行前請先停止同 port 的 development server。可用 `M4_FRONTEND_PORT` 指定另一個 port。

```powershell
npm.cmd exec -- playwright install chromium
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run preview
```

如要使用本機 Chrome，可設定 `$env:PLAYWRIGHT_CHANNEL = 'chrome'` 並略過 Chromium 下載。無 mock 的整合測試需要一筆已持久化的 `partial` Job，且有有效及無效紀錄。使用下方的受控 Compose workflow，或以已核准的 CSV Profile 提交 `backend/tests/fixtures/m1/listings.csv`。如採用該 CSV，Profile 可映射 `Key`、`Name` 及整數 `Count`，並先用有效 sample 通過 Validation 和 Approval。

```powershell
# Run in frontend/ and point to the controlled test API.
$env:API_PROXY_TARGET = 'http://127.0.0.1:58000'
$env:M4_REAL_API = '1'
npm.cmd test
Remove-Item Env:M4_REAL_API, Env:API_PROXY_TARGET
```

開發環境使用條件及 Node.js 版本依 [Vite 文件](https://vite.dev/guide/)。

## M3 非同步 Collection Jobs

Docker Desktop 使用 Linux containers。Windows 11 需要啟用 WSL2 並確認 Docker Engine 可用。原生 Python 以 3.12 為基線。先在 repository 根目錄複製 `.env.example` 至 `.env`（已有設定時沿用），填入本機專用 PostgreSQL 密碼。PostgreSQL 和 API 的 host ports 分別由 `POSTGRES_PORT`、`API_PORT` 控制。Redis 留在 Compose 網路內。

```powershell
docker version
docker compose version
docker compose config --quiet
docker compose up -d --wait postgres redis
docker compose build api
docker compose run --rm api python -m alembic upgrade head
docker compose run --rm api python -m alembic current --check-heads
docker compose up -d --wait api worker dispatcher
docker compose logs --tail 100 api worker dispatcher
```

升級既有 M2 時先停止原有執行者，再跑 migration。原生 DB 可用 `DATABASE_URL` 及 `postgresql+psycopg` driver。API OpenAPI 預設在 `http://127.0.0.1:8000/docs`。建立 Source 和 Draft，Preview、Validate，再以 report ID、config hash 和 operator 批准。提交 `POST /api/v1/collection-jobs` 後，在 Job details、events 和 records 查看進度及結果。CSV 使用已授權 dataset ID 和 inline UTF-8 text，可讀取 `backend/tests/fixtures/m1/listings.csv`。原生 CLI 仍可用 `python -m backend.cli '<job UUID>'`；由同一 claim policy 管理。

如要執行原生 API、Dispatcher 或 Linux worker，使用同一 PostgreSQL 設定和絕對 `EVIDENCE_ROOT`，另設指向專用 Redis 的 `CELERY_BROKER_URL`。預設 evidence 在 `var/evidence`。

```powershell
py -3.12 -m venv .venv
$python = '.\.venv\Scripts\python.exe'
& $python -m pip install -r backend/requirements.txt
& $python -m alembic upgrade head
# Run each service in a separate terminal with the same environment.
& $python -m uvicorn backend.api.app:create_app --factory --host 127.0.0.1 --port 8000
& $python -m backend.queue.dispatcher
```

Linux worker command 為 `python -m celery -A backend.queue.celery_app:app worker --pool=prefork --loglevel=INFO`。Windows 本機測試可用 `--pool=solo`，程序及 hard timeout 驗收以 Linux 為準。Host 的 Web fixture 可透過 `python -m http.server 8001 --bind 127.0.0.1 --directory backend/tests/fixtures/m0` 供應。將確切 loopback origin 放入 Source policy。

### 受控 Compose 與測試

先跑 PostgreSQL named-volume gate。以目前 checkout 的 migration 0006 與原有 M2 API／CLI restart 案例驗證，請在同一個 PowerShell 使用專用 project。以下 port 必須空閒。

```powershell
$python = '.\.venv\Scripts\python.exe'
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m2_gate'
$env:POSTGRES_PORT = '55434'
$env:POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:M2_TEST_COMPOSE_PROJECT = 'collection-m2-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$env:M2_TEST_DATABASE_URL = "postgresql+psycopg://${env:POSTGRES_USER}:${env:POSTGRES_PASSWORD}@127.0.0.1:${env:POSTGRES_PORT}/${env:POSTGRES_DB}"
docker compose -p $env:M2_TEST_COMPOSE_PROJECT up -d --wait postgres
& $python -m pytest -q -rs -s backend/tests/m2/test_process_restart.py
docker compose -p $env:M2_TEST_COMPOSE_PROJECT stop postgres
Remove-Item Env:M2_TEST_COMPOSE_PROJECT, Env:M2_TEST_DATABASE_URL
```

使用專用 project 與獨立資料卷。Fixture overlay 允許 API 和 Worker 使用 `http://collection-fixture:8001/table.html`，Source 仍需批准並授權該 origin。以下 PowerShell 使用測試用 host ports。請在同一 shell 執行。

```powershell
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m3_test'
$env:POSTGRES_PORT = '55433'
$env:API_PORT = '58000'
$env:POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:M3_TEST_COMPOSE_PROJECT = 'collection-m3-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$env:M3_TEST_COMPOSE_API_URL = 'http://127.0.0.1:58000'
$composeArgs = @('-p', $env:M3_TEST_COMPOSE_PROJECT, '-f', 'compose.yaml', '-f', 'compose.fixture.yaml')
docker compose @composeArgs config --quiet
docker compose @composeArgs up -d --wait postgres redis
docker compose @composeArgs build api
docker compose @composeArgs run --rm api python -m alembic upgrade head
docker compose @composeArgs up -d --wait
& $python -m pytest -q -rs -s backend/tests/m2/test_m3_compose.py
docker stats --no-stream $(docker compose @composeArgs ps -q)
docker compose @composeArgs stop
```

保存同一測試 project 的 DB 密碼以供重啟。更改密碼環境變數不會更改已初始化 volume 的 DB login。M2 named-volume gate 會比對 PostgreSQL container 實際掛載的 volume 和重啟前後的資料。M3 Compose 測試會正常停止 Redis、提交 Job、恢復 broker，再重啟 Compose 服務並比較 DB metadata 和兩個容器讀到的 evidence bytes。 另一個案例在結果交易等待 PostgreSQL 鎖時以 SIGKILL 終止專用 prefork Worker container，重新啟動後等待實際 lease 到期，並驗證第二次 attempt、單一終態事件及 Evidence。

原生整合測試另需 `M2_TEST_DATABASE_URL` 和 `M3_TEST_BROKER_URL`，分別指向獨立 PostgreSQL 測試庫與空的專用 Redis。可選填 `M3_TEST_REDIS_SERVER` 的 executable 路徑，測試會在獨立 port 啟停 Redis。完整命令與環境結果見 M3 Test Results。

```powershell
& $python -m pytest -q -rs --tb=short backend/tests
& $python -m ruff check backend
& $python -m ruff format --check backend
git diff --check
```

### 停止、重啟及故障排查

- 日常以 `docker compose stop` 停止服務，以 `docker compose up -d --wait` 重啟。原有 named volumes 會保留。使用 fixture overlay 時，每個命令都使用相同 project 和兩份 Compose 檔。
- Pending Job 先查 events、`dispatch_due_at`、`dispatch_error_code` 和 Dispatcher logs。確認 Redis health 及 Worker 已註冊 `collection.execute_job`。Broker 恢復後 Dispatcher 會重派。
- Running Job 檢查 `lease_expires_at` 和 Worker logs。過期後 Dispatcher 會安排有上限的復原。若 Worker 和 CLI 曾被強制終止，依架構文件辨識未被 DB 引用的 evidence。
- DB 連線失敗時檢查 Compose health、連接埠、目標 DB 和 login。Stale approval 回傳 409 時，使用當前 Draft 重新 Validate。
- M3 採 at-least-once execution attempts，可能重複發送受控 HTTP requests。Job 結果與 evidence metadata 在 PostgreSQL 交易內發布。跨 Job quota、fleet heartbeat、容器資源驗收狀態見 readiness review。

- [M3 Architecture](docs/architecture/M3-worker-architecture.md) · [Job Contract](docs/contracts/M3-job-execution-contract.md) · [Reliability Decisions](docs/decisions/M3-reliability-decisions.md)
- [M3 Test Results](docs/experiments/M3-test-results.md) · [Issue Manifest](docs/experiments/M3-issue-manifest.md) · [Readiness Review](docs/experiments/M3-readiness-review.md)
- [M2 REST API Contract](docs/contracts/M2-api-contracts.md) · [Persistence Architecture](docs/architecture/M2-persistence-architecture.md) · [Database Decisions](docs/decisions/M2-database-decisions.md)
- [M2 Test Results](docs/experiments/M2-test-results.md) · [Issue Manifest](docs/experiments/M2-issue-manifest.md) · [Readiness Review](docs/experiments/M2-readiness-review.md)

## 安裝及示範 M1

從專案根目錄執行。已驗證 Windows 11 x64 和 CPython 3.12.14。

```powershell
py -3.12 -m venv .venv
$python = '.\.venv\Scripts\python.exe'
& $python -m pip install -r backend/requirements.txt
& $python -m pip check
& $python -m pytest -q backend/tests/m1
& $python -m ruff check backend
& $python -m ruff format --check backend
```

如果 `py` 未登記 Python 3.12，第一行可用已安裝 CPython 3.12 的完整 executable 路徑。HTTP 測試使用 `127.0.0.1` 的臨時連接埠。

以下指令是可重現的本機示範。測試會啟動受控網站、完成 Profile lifecycle、執行 HTML 及 CSV，並按 evidence ID 讀回原始資料。

```powershell
& $python -m pytest -v backend/tests/m1/test_m1_runner.py
```

Library 入口為 `CollectionRunner`、`ProfileRepository` 和 `LocalEvidenceStore`。先以 `register_source()` 登記受信任的 Source，再以 `create_draft()` 建版本。呼叫 `preview()` 和 `validate()` 後，Operator 以 `approve(..., approver=..., report_id=...)` 批准，並把同一 `profile_version_id` 交給 `run()`。Web 使用 `WebInput(url)`，CSV 使用 `CsvInput(dataset_id, content)`。應用程式可將 `var/evidence/` 作本機輸出位置，此目錄已排除於 Git。

- [M1 Core contracts 與架構](docs/contracts/M1-collection-core.md)
- [M1 本機 Issue Manifest](docs/experiments/M1-issue-manifest.md)
- [M1 測試及 M2 readiness](docs/experiments/M1-readiness-review.md)

## 重現 M0

從專案根目錄執行。已驗證環境為 Windows 11 x64 和 CPython 3.12.14。

```powershell
py -3.12 -m venv .m0-venv
$m0Python = '.\.m0-venv\Scripts\python.exe'
& $m0Python -m pip install -r backend/experiments/scrapling_spike/requirements.txt
& $m0Python -m pip check
& $m0Python -m pytest -q backend/tests/test_m0_extraction.py backend/tests/test_m0_http.py
& $m0Python -m ruff check backend
& $m0Python -m ruff format --check backend
```

如 `py` 未登記 Python 3.12，第一行可用 CPython 3.12 的完整 executable 路徑。測試啟動 `127.0.0.1` 的臨時連接埠。套件安裝需要 PyPI 存取，測試本身只使用本機。Patchright Python 套件是 Scrapling 0.5.1 的匯入相依項，毋須下載 Chromium 或啟動 browser runtime。

- [Baseline](docs/experiments/M0-baseline-report.md) 和 [開發環境](docs/experiments/M0-environment-report.md)
- [Scrapling 實驗結果](docs/experiments/M0-scrapling-spike.md)
- [Core contracts](docs/contracts/M0-core-contracts.md) 和 [Architecture decisions](docs/decisions/M0-architecture-decisions.md)
- [M0 驗收及 M1 readiness](docs/experiments/M0-readiness-review.md)
