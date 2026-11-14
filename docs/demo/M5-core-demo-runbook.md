# M5 Core RC Demo Runbook

以 PowerShell 7 自 repository root 操作。需要 Python 3.12、Docker Desktop Linux Engine（WSL2）、Docker Compose、Node.js 22 和 npm。使用 [安裝說明](../../README.md) 及現有 dependencies；首次 npm 安裝用 `npm.cmd ci`，瀏覽器用 Playwright 的 locked package 安裝。

## 啟動隔離 Compose 及前端

```powershell
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m5_test'
$env:POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:POSTGRES_PORT = '55495'
$env:API_PORT = '58095'
$demoProject = 'collection-m3-test-m5-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$composeArgs = @('-p',$demoProject,'-f','compose.yaml','-f','compose.fixture.yaml')
docker compose @composeArgs build api
docker compose @composeArgs up -d --wait postgres redis
docker compose @composeArgs run --rm --no-deps api python -m alembic upgrade head
docker compose @composeArgs up -d --wait
Invoke-RestMethod "http://127.0.0.1:${env:API_PORT}/api/v1/health"
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
docker compose @composeArgs logs --tail 50 dispatcher worker
```

Health 回 `{"status":"ok"}`、migration 為 `0006 (head)` 且沒有 drift，Worker log 應有 `collection.execute_job` 及 `ready`。首次啟動時如 port 暫未就緒，短候後重試 health。保留 terminal 環境、project 名稱與 DB 密碼供停止／重啟。測試使用 Compose 自己的 PostgreSQL、Redis 與 Evidence volumes。

另開 PowerShell，從 repository root 執行下列命令。在可信本機 console 使用 [Collection Jobs](http://127.0.0.1:5197/collection-jobs)。

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run build
$env:API_PROXY_TARGET = 'http://127.0.0.1:58095'
$env:LOCAL_PROFILE_APPROVAL = '1'
npm.cmd run dev -- --port 5197 --strictPort
```

Vite 是 Windows host 上的 React frontend 服務；其同源 `/api/v1` 轉發至 API。Compose fixture 無 host port。Vite production build／preview 停用 UI Approval opt-in。 `LOCAL_PROFILE_APPROVAL=1` 限 local development proxy。Operator label 由操作者填報。

## 走通兩種輸入與追溯

依 M4 runbook 第 2–4 節建立兩個 Pending Sources，從 terminal 各自核准 Source access，另建立版本並完成 Preview、Validation 和 Approval。將該文件的 API port 替換為當次 `API_PORT`。HTML 使用 `#entries tr`／`a`／`data-code`；CSV 以 `Key`、`Name`、`Count` 欄位映射並從 clean sample 驗證。 [Console 操作步驟](M4-core-demo-runbook.md)

- HTML 完成後核對 **Succeeded**，Valid／Invalid／Duplicates 為 2／0／0。CSV 貼上 `backend/tests/fixtures/m1/listings.csv`，核對 **Partial** 和 2／3／1。
- 從 Job Details 核對按序的 events、Source、pinned Profile；開啟 Record 和 Quarantine。CSV errors 對應起始實體行 5／6／7。
- 開啟 Evidence Metadata 並核對 SHA-256。後端操作員可在隔離容器以 UUID hex 讀取 raw bytes。 `$evidenceId` 由 UI 或 API 取得。

```powershell
$evidenceHex = ([Guid]$evidenceId).ToString('N')
docker compose @composeArgs exec -T api sha256sum "/data/evidence/$evidenceHex/input.bin"
```

## 可重跑的全量驗收

以啟動 Compose 的 terminal 設定下列變數。要跑完整 broker integration，須在獨立 Redis DB 或專用 instance 跑 host Celery tests，和 Compose 的 broker DB `0` 分隔。僅在驗收 overlay 加 `127.0.0.1:56395:6379`，把 `M3_TEST_BROKER_URL` 指向 `redis://127.0.0.1:56395/1`。啟動前把 overlay 加入 `$composeArgs`。如使用 Compose overlays，也將同一組額外檔案依次傳給 test subprocesses。

```powershell
New-Item -ItemType Directory -Force var/m5-local | Out-Null
@'
services:
  api:
    image: collection-backend:m5-acceptance
    mem_limit: 256m
  worker:
    image: collection-backend:m5-acceptance
    mem_limit: 512m
  dispatcher:
    image: collection-backend:m5-acceptance
    mem_limit: 256m
  collection-fixture:
    image: collection-backend:m5-acceptance
    mem_limit: 128m
  postgres:
    mem_limit: 512m
  redis:
    mem_limit: 128m
    ports:
      - "127.0.0.1:56395:6379"
'@ | Set-Content -Encoding utf8 var/m5-local/compose.acceptance.yaml
$composeArgs += @('-f','var/m5-local/compose.acceptance.yaml')
# 從啟動一節執行相同的 build、up、upgrade、up 和 health 檢查。
```

```powershell
# On a fresh checkout, create the host test environment first.
py -3.12 -m venv .venv
$python = '.\.venv\Scripts\python.exe'
& $python -m pip install -r backend/requirements.txt pytest==9.2.0 ruff==0.17.5
$env:M2_TEST_DATABASE_URL = "postgresql+psycopg://${env:POSTGRES_USER}:${env:POSTGRES_PASSWORD}@127.0.0.1:${env:POSTGRES_PORT}/${env:POSTGRES_DB}"
$env:M2_TEST_COMPOSE_PROJECT = $demoProject
$env:M3_TEST_COMPOSE_PROJECT = $demoProject
$env:M3_TEST_COMPOSE_API_URL = "http://127.0.0.1:${env:API_PORT}"
$env:M3_TEST_BROKER_URL = 'redis://127.0.0.1:56395/1'
# 用於實際驗收的 overlay 範例。未使用該檔時，請按實際檔案更改。
$env:M3_TEST_COMPOSE_EXTRA_ARGS = '-f var/m5-local/compose.acceptance.yaml'
$env:M4_COMPOSE_OVERLAYS = 'var/m5-local/compose.acceptance.yaml'
& $python -m ruff check backend
& $python -m ruff format --check backend
& $python -m pytest -q -rs --tb=short -s backend/tests
& $python -m backend.experiments.m5_evaluation --workers 1
```

可設 `M3_TEST_REDIS_SERVER` 為本機既有 Redis executable；這會使 native outage case 在同一個專用 port 啟停真實 Redis。另有獨立 Compose outage case 會真實停止並恢復 Redis。Browser suites 依序執行，並先停止同 port 的 Vite。Jobs live test 讀取其中一個已完成 Partial Job，前面的 backend tests／evaluation 或手動示範會建立該資料。

```powershell
Push-Location frontend
npm.cmd ci
npx.cmd playwright install chromium firefox webkit
npm.cmd run typecheck
npm.cmd run build
$env:M4_FRONTEND_PORT = '5197'
$env:PLAYWRIGHT_BROWSER = 'chromium'
$env:M4_REAL_API = '0'
$testOutput = '../var/m5-local/playwright-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
npm.cmd test -- --workers=2 "--output=$testOutput-controlled-chromium"
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = $env:M3_TEST_COMPOSE_API_URL
$env:M4D_COMPOSE_PROJECT = $demoProject
$env:M4E_COMPOSE_PROJECT = $demoProject
npm.cmd test -- --workers=1 "--output=$testOutput-live-chromium"
Remove-Item Env:M4D_COMPOSE_PROJECT,Env:M4E_COMPOSE_PROJECT
foreach ($browser in @('firefox','webkit')) {
  $env:PLAYWRIGHT_BROWSER = $browser
  npm.cmd test -- tests/core-workflow.integration.ts tests/closure.integration.ts tests/sources.integration.ts --workers=1 "--output=$testOutput-live-$browser"
}
Pop-Location
```

已有指定版本的 project-local browser cache 時可設定 `PLAYWRIGHT_BROWSERS_PATH` 後直接跑測試。缺失時先確認 Node、lockfile 和 packages，再使用官方 Playwright download。用 `M4E_CAPTURE_DIR`／`M4D_CAPTURE_DIR` 指定忽略的資料夾，可以額外保存 axe 驗證的 viewport captures。

## 安全停止與重啟

```powershell
docker compose @composeArgs ps
docker compose @composeArgs logs --tail 50 api dispatcher worker
# 於 frontend terminal 用 Ctrl+C 結束 Vite。
docker compose @composeArgs stop
docker compose @composeArgs up -d --wait
Invoke-RestMethod "http://127.0.0.1:${env:API_PORT}/api/v1/health"
# 比對原 Job、Events、Records、Quarantine、Evidence 與 checksum 後結束。
docker compose @composeArgs stop
```

若看到 `all predefined address pools have been fully subnetted`，以 `docker network ls` 和 `docker network inspect` 核對已用網段及 host/VPN 路由，再在隔離驗收 overlay 的 `networks.default.ipam.config` 和 `networks.fixtures.ipam.config` 設兩個未重疊 subnet。保留現有 projects、network 和 named volumes。API 503 時查 PostgreSQL health、同一個 project 的 login，及 Vite proxy 設定。詳細 UI recovery 例子在 M4 runbook 第 5 節。 [操作排查](M4-core-demo-runbook.md#5-排查與安全停止)
