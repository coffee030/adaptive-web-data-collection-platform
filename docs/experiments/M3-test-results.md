# M3 Verification Results

驗證日期為 2026-11-14（香港時間）。Windows 11 Pro 25H2 build 26200，約 31.9 GiB visible RAM，查核當時約 15.7 GiB available。CPython 3.12.14、PostgreSQL 17.7、Celery 5.6.3、Kombu 5.6.2、redis-py 5.2.1、Redis 7.4.8。測試 DB 使用 `127.0.0.1:55439`、32 MiB shared_buffers、獨立 cluster 和每個 case 的隔離 schema。未使用開發 DB。專用 Redis 為經 SHA-256 核對的 Windows portable build，綁定 `127.0.0.1:56379`，禁用其持久化供 native tests。Evidence 在 pytest 暫存目錄。專案預設為 `var/evidence`。

初次 Windows 原生回歸時，Docker Desktop、Engine、WSL2 runtime 與 Linux containers 尚不可用。獨立 Compose v2.40.3 可驗證 config。Docker Hub registry 已查核 Dockerfile 及 Compose 的 Python、Redis、PostgreSQL tags 均有 Linux amd64 manifests。容器 build、Linux prefork、Docker volume restart 和 Docker 資源用量待測。

## 命令及結果

以 repository 根目錄執行。原生測試環境配置如下。路徑指向本次專用 runtime。替換為其他已準備好的專用測試服務亦可。

```powershell
$python = '.\.venv\Scripts\python.exe'
$env:M2_TEST_DATABASE_URL = 'postgresql+psycopg://collection_test@127.0.0.1:55439/collection_m3_test'
$env:M2_TEST_PG_CTL = (Resolve-Path 'var/m2-postgres/pgsql/bin/pg_ctl.exe').Path
$env:M2_TEST_PGDATA = (Resolve-Path 'var/m3-postgres-test/data').Path
$env:M3_TEST_BROKER_URL = 'redis://127.0.0.1:56379/0'
$env:M3_TEST_REDIS_SERVER = (Get-ChildItem var/m3-redis-test -Recurse -Filter redis-server.exe | Select-Object -First 1).FullName
$env:DATABASE_URL = $env:M2_TEST_DATABASE_URL
& $python -m pytest -q -rs --tb=short backend/tests
& $python -m pip check
& $python -m ruff check backend
& $python -m ruff format --check backend
& $python -m alembic upgrade head
& $python -m alembic current --check-heads
& $python -m alembic check
git diff --check 2790cc3 HEAD
```

| 驗證 | 結果 |
| --- | --- |
| M2 基線 `pytest -q --tb=short backend/tests` | 134 PASS，24.73s，含原生 PostgreSQL restart |
| Batch A／B Redis ping、registration、CSV duplicate | Redis PONG；無 listener 時 Kombu OperationalError；真實 worker 測試 1 PASS |
| Batch C `pytest -q backend/tests/m2` 與 reliability 子集 | 23 PASS；新增 reliability 6 PASS |
| Batch D M3 retry 與 M1 adapter 分開執行 | 20 PASS、36 PASS |
| M3 完整 `pytest -q -rs --tb=short backend/tests` | 170 PASS、1 SKIPPED（專用 Compose 執行環境未設定），新增驗證涵蓋 migration 和真實 DB unavailable |
| `pip check`、Ruff check／format | PASS，Ruff 核對 56 files |
| Alembic upgrade／current／check | PASS，0005 head，無 schema drift；另以有資料的 schema 測試 downgrade 到 0004 後再升級 |
| `docker-compose.exe -p collection-m3-test config --quiet` | PASS，Compose v2.40.3 |
| `docker-compose.exe -p collection-m3-test -f compose.yaml -f compose.fixture.yaml config --quiet` | PASS，6 個 services |
| `git diff --check 2790cc3 HEAD` | PASS。未加範圍的命令仍會指出既有 teammate brief 檔尾空白 |
| Docker M2／M3 runtime | BLOCKED，缺少 Engine 和 WSL2 |

## 真實故障及結果

- CSV duplicate 測試用真實 Redis 及獨立 Windows solo Worker，1 筆 Record、1 個 Evidence 目錄、1 個終態 event。
- HTML 經真實 TCP API、獨立 Dispatcher、Redis 及 Worker 完成。兩個 Worker 在線，2 筆 Records，Evidence bytes 和 SHA-256 相同。另在第一個 Worker 持有 claim 時向第二個送 duplicate，第二個跳過，只有一次 attempt。
- Broker 測試在同一 dedicated port 正常啟動、停止、再啟動 Redis。離線時 Job 為 pending 並留有 `broker_unavailable`，重啟後第 2 次派送完成。
- 資料庫不可用測試讓獨立 Worker 連到未開放的 PostgreSQL port。Job 保持 pending、execution attempt 為 0，推進派送期限後，由可連線的 Worker 完成。
- Worker interruption 測試在結果交易受 PostgreSQL 鎖阻塞時強制終止程序。原 attempt 沒有結果 row，推進 DB lease 到期後 Dispatcher 重新派送，attempt 2 完成。
- Commit／ack 測試使用測試專用 Worker 在 Celery ACK 邊界暫停，確認 DB 已提交後終止。測試只推進該 Redis unacked entry 的 visibility 時間，呼叫 Kombu 原有 restore，讓新 Worker 收到同一訊息。Job、events、record 和 evidence 保持相同。
- 過期 completion 與 transaction rollback 測試涵蓋 PostgreSQL ownership、Result rollback 及 evidence orphan 辨識。測試期也曾遇到 fixture 未匯入和 Redis restoration cadence 超過測試等待，修正 harness 後通過。Alembic CLI 曾與 native restart 重疊，待重啟完成後重跑通過。

## 原生資源抽樣

兩個 Worker 的 HTML 整合案例通過。Windows `Win32_Process.WorkingSetSize` 以約 200 ms 間隔抽樣，列出各組 observed peak。PostgreSQL 數字只涵蓋 postmaster。各組峰值可能在不同時間，且工作集可含共享頁。沒有 Linux containers 或 8 GB 整機 measurements。

| Process group | Observed peak |
| --- | ---: |
| FastAPI | 107.0 MiB |
| Dispatcher | 101.0 MiB |
| Two Celery solo workers | 216.1 MiB |
| Redis | 14.7 MiB |
| PostgreSQL postmaster | 18.5 MiB |

Transport 行為參考 [Celery 5.6 configuration](https://docs.celeryq.dev/en/v5.6.3/userguide/configuration.html)。Native Redis 來源為 [portable release 7.4.8](https://github.com/redis-windows/redis-windows/releases/tag/7.4.8)。

## Final acceptance preflight

2026-11-14（香港時間）。以 3947ddc 為基線重跑 `python -m pytest -q -rs backend/tests`，結果為 170 passed、2 skipped、0 failed，耗時 95.73 秒。兩個 skip 都來自 `test_m3_compose.py` 缺少專用 project 與 API URL，當時本機尚無可用的 Linux Engine。Windows 原生 PostgreSQL 17.7 restart、真實 Redis 7.4.8 及 Celery 5.6.3 回歸通過。 `python -m alembic upgrade head`、`current --check-heads`、`check` 均通過，schema 為 0005，無 drift。Ruff lint／format、`pip check` 及既有 Compose v2.40.3 的 fixture overlay 靜態驗證通過。

驗收測試已加強實際 PostgreSQL volume 比對、CSV partial／quarantine／duplicate counts，以及 SIGKILL 後實際 lease 到期時間的檢查。這些 Docker assertions 待實際 Linux Engine 執行。

已依授權從 Docker 官方下載 Desktop 4.99.0 AMD64 installer。SHA-256 為 A5E299131C9C53D60F3F752B162078945EB5FAF6EEDCF0BE20A214C6E6CEA444，與官方相符。Authenticode 為 Valid，簽署者 Docker Inc。Microsoft WSL 3.0.5 和 kernel 6.18.58.1-1 已安裝，Virtual Machine Platform 已執行啟用，WSL2 仍等待 Windows 重啟後驗證。Python dependencies 已齊全。

官方來源：[Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/) · [Docker Desktop 4.99.0](https://docs.docker.com/desktop/release-notes/#4990)。

### Docker Desktop post-reboot check

Docker Desktop 4.99.0 已透過官方 installer 安裝到目前使用者。Installer exit code 0。Docker CLI 為 29.9.3，Compose 為 v5.7.0。Windows 已重啟，Virtual Machine Platform 為 Enabled，Windows servicing reboot pending 已清除。Docker Desktop 由 starting 轉為 stopped，backend 報 `WslVirtualizationDisabledInFirmware` 和 `HCS_E_HYPERV_NOT_INSTALLED`。Windows 查得 `VirtualizationFirmwareEnabled=False`、`VMMonitorModeExtensions=True`、`HypervisorPresent=False`。若這是實體主機，需由操作者在 UEFI 啟用 CPU virtualization。若是 VM，需由主機管理員提供 nested virtualization，或使用已授權的 Linux Engine。

## Linux Docker closure

2026-11-14（香港時間）。ASUS 實體 Windows 11 主機的 AMD Ryzen 7 5800X 現回報 `VirtualizationFirmwareEnabled=True`、`HypervisorPresent=True`，Virtual Machine Platform 已啟用。重新啟動已安裝的 Docker Desktop 後，`wsl -l -v` 顯示 `docker-desktop Running 2`。Docker Desktop 4.99.0、Engine 29.9.3（`OSType=linux`）、Compose 5.7.0、WSL 3.0.5。主機約 31.9 GiB RAM，Docker Engine 報 16 CPU、15.56 GiB RAM。此輪沿用既有安裝。

| Gate | 實際結果 |
| --- | --- |
| A PostgreSQL persistence | PASS。專用 project `collection-m2-test-3bfe9ebf` 執行 `python -m pytest -q -rs -s backend/tests/m2/test_process_restart.py`，1 passed in 8.04s。正常重啟後，同一 container 保留 `collection-m2-test-3bfe9ebf_postgres_data`，API 回讀、Evidence bytes 及 SHA-256 一致。 |
| B Linux Redis／Celery | PASS。Redis 7.4.8 回傳 PONG，Linux Celery 5.6.3 報 `concurrency: 1 (prefork)`，登記及接收 `collection.execute_job`。PostgreSQL image 實際為 17.12。 |
| C HTML／CSV | PASS。HTML 2 筆有效 Records。CSV 為 partial，2 筆有效、1 筆 quarantine、1 筆 duplicate。來源及 Profile 經 API 核准，Evidence ID、原始 bytes 和 SHA-256 均可回讀。 |
| D SIGKILL／lease | PASS。Job `0139bfbf-cdb3-44cb-8bb1-6d18e31b2cd6` 的 attempt 1 被 SIGKILL。實際 lease 到期 2026-11-14 04:26:32.263670 HKT，Worker loss 04:26:32.461751，attempt 2 完成於 04:26:37.603926。未推進時鐘。只保留一筆結果及一個 SUCCEEDED 事件。 |
| E Broker／restart | PASS。Redis 停止時保留 pending Job 並記錄 broker failure。恢復後完成，重新送同一 Job UUID 由 Linux Worker 記錄 `job_not_pending`，Job 和 events 一致。服務重啟後回讀 PostgreSQL snapshot 和 API／Worker 共享 Evidence，實際掛載的 PostgreSQL volume 名稱一致。 |

`python -m pytest -q -rs -s backend/tests/m2/test_m3_compose.py` 在 `collection-m3-test-e07466b3` 得 2 passed in 123.08s。容器內 Alembic upgrade／current／check 通過，0005 head，無 drift。Linux image 建置時 `pip check` 通過。官方 image digests 為 PostgreSQL `sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065`、Redis `sha256:7aec734b2bb298a1d769fd8729f13b8514a41bf90fcdd1f38ec52267fbaa8ee6`、Python base `sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e`。

### 容器資源

驗收完成後用 `docker stats --no-stream` 抽樣，單次觀測值如下。六個容器合計約 313 MiB，尚未在 8 GB 主機量測整機負載與可用性。

| Service | CPU | Memory |
| --- | ---: | ---: |
| PostgreSQL | 2.68% | 32.10 MiB |
| Redis | 0.34% | 4.71 MiB |
| API | 0.15% | 77.89 MiB |
| Dispatcher | 0.22% | 73.73 MiB |
| Worker | 0.12% | 111.60 MiB |
| Fixture | 0.01% | 13.16 MiB |

完整回歸使用另一個隔離 project `collection-m3-test-8e103692`。Windows pytest 連接 Linux PostgreSQL、專用本機 Redis，並執行真實 Linux Compose 案例。`python -m pytest -q -rs -s backend/tests` 得 172 passed、0 failed、0 skipped，耗時 216.20 秒。第二次 SIGKILL Job `142ab8a8-eb63-4447-a728-a2cfb50a07e5` 的 lease 於 04:29:02.762686 HKT 到期，04:29:02.959849 記錄 Worker loss，attempt 2 於 04:29:08.089672 完成。第二次容器記憶體抽樣約 324 MiB。兩個測試 project 均停止，保留 volumes。
