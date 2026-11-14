# M4 個人本機驗收清單

依使用者決定，M4 由本人進行本機驗收。GitHub 延至 M5，組員覆核已移出 M4。

## Checkout

Branch 為 `fix/M4-closure`。程式與測試的審查基準為 `439e1a2b1e98f4d3bf53919ec07507e8df099ece`。Diff 由 M4-E `081c5f3` 起算。交接檔位於專案外層。請用 `git rev-parse HEAD` 記錄實際測試的 commit。

可直接在原 repo 驗收。若要用乾淨的 checkout，可開獨立 worktree。

```powershell
git worktree add --detach ../Adaptive-Web-M4-review fix/M4-closure
Set-Location ../Adaptive-Web-M4-review
git status --short
git rev-parse HEAD
git diff --stat 081c5f3 439e1a2
git diff --exit-code 439e1a2 HEAD -- backend frontend compose.yaml compose.fixture.yaml
```

## Architecture and review checklist

React／TypeScript 透過 Vite 的 loopback proxy 連到 FastAPI。PostgreSQL 保存 Source、不可變 Approved Profile、Job、事件和結果。Dispatcher 讀取 durable Job 並透過 Redis 發送給 Celery worker，worker 回寫結果與 Evidence metadata。

| Area | Check | Code and acceptance evidence |
| --- | --- | --- |
| Backend | [ ] Source authorization、授權與核准各自生效、foreign Host／Origin 被拒 | `backend/api/app.py`、`backend/api/profiles.py`、`frontend/vite.config.ts`。Pending／revoked access 的提交應失敗。核准要求本機設定、有效 report 和明確確認。 |
| Backend | [ ] Profile lifecycle／併發 | `backend/application/profiles.py`、`backend/persistence/profiles.py`。兩個 client 同 revision 並行 PUT 僅一筆成功。核對 409、428、stale report 和 approved immutability。 |
| Backend | [ ] Source 與 Job idempotency、migration | `backend/migrations/versions/0006_source_request_key.py`、`backend/application/profiles.py`、`backend/application/jobs.py`。同 key 同 payload 查回原 ID、異 payload 409。核對 exact Profile pin 及 0006 無 drift。 |
| Backend | [ ] Job execution 和復原 | `backend/queue/dispatcher.py`、`backend/queue/celery_app.py`、`compose.yaml`。核對代理、Worker 重啟、503、相同 key 重試、事件及終態。 |
| Console | [ ] Source／Profile 操作及錯誤 | `frontend/src/features/sources/`、`frontend/src/features/profiles/`、`frontend/src/lib/requestIntent.ts`。兩個 Draft tabs 驗證衝突、未存輸入、reload 和表單確認。 |
| Console | [ ] Job、Records、Evidence traceability | `frontend/src/features/collection-jobs/`、`frontend/src/features/results/`、`backend/application/results.py`。檢查 2／3／1 結果、Evidence-only Job、Source／Profile lineage、無內部 storage path，以及終態停止 polling。 |
| Console | [ ] 鍵盤與 Narrator | 依 [Narrator acceptance](M4-narrator-acceptance.md) 實際聽測，回報焦點、錯誤、確認、更新和資料導覽。 |

## Test commands

在隔離 checkout 使用既有 `.venv`，或依 [README](../../README.md) 以 Python 3.12 和 `backend/requirements.txt` 建立。以下命令以 Windows PowerShell 執行。先按 [Demo Runbook 第 1 節](../demo/M4-core-demo-runbook.md) 的第一個視窗設定 ports、唯一 `$demoProject`、啟動服務和 migration。保留該視窗的資料庫環境。Playwright 測試使用自啟 Vite，請保留其 port。所有 live suites 依序執行，因部分 tests 會重啟自己的隔離服務。

```powershell
# Repo root，沿用 Runbook 的 Compose 環境及 $composeArgs / $demoProject。
$python = '.\.venv\Scripts\python.exe'
$env:M2_TEST_DATABASE_URL = "postgresql+psycopg://${env:POSTGRES_USER}:${env:POSTGRES_PASSWORD}@127.0.0.1:${env:POSTGRES_PORT}/${env:POSTGRES_DB}"
$env:M2_TEST_COMPOSE_PROJECT = $demoProject
$env:M3_TEST_COMPOSE_PROJECT = $demoProject
$env:M3_TEST_COMPOSE_API_URL = "http://127.0.0.1:${env:API_PORT}"

& $python -m ruff check backend
& $python -m ruff format --check backend
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
& $python -m pytest -q -rs --tb=short backend/tests/m2/test_m4_closure.py

# Full backend：以獨立 Redis 避免 host worker 與 Compose worker 共用 queue。
$reviewRedis = "m4-review-redis-$($demoProject.Split('-')[-1])"
$env:M3_TEST_BROKER_URL = 'redis://127.0.0.1:56396/0'
docker run --rm -d --name $reviewRedis -p 127.0.0.1:56396:6379 --tmpfs /data redis:7.4.8-alpine
if ($LASTEXITCODE -ne 0) { throw 'Dedicated review Redis did not start' }
try {
  docker exec $reviewRedis redis-cli ping
  & $python -m pytest -q -rs --tb=short backend/tests
} finally {
  docker stop $reviewRedis
}
```

若 `56396` 已用，請同步改 port mapping 和 `M3_TEST_BROKER_URL`。在 browser suite 前再確認 Compose health；從同一個視窗進入 frontend，以繼承 Compose credentials，供 live restart 使用。

```powershell
$env:API_PROXY_TARGET = "http://127.0.0.1:${env:API_PORT}"
Push-Location frontend
npm.cmd ci
npx.cmd playwright install chromium firefox webkit
npm.cmd run typecheck
npm.cmd run build
$env:M4_FRONTEND_PORT = '5195'
$env:M4_REAL_API = '0'
$env:PLAYWRIGHT_BROWSER = 'chromium'
npm.cmd test -- --workers=1

$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:M4E_COMPOSE_PROJECT = $demoProject
$env:M4D_COMPOSE_PROJECT = $demoProject
npm.cmd test -- --workers=1
Remove-Item Env:M4E_COMPOSE_PROJECT,Env:M4D_COMPOSE_PROJECT
foreach ($browser in @('firefox','webkit')) {
  $env:PLAYWRIGHT_BROWSER = $browser
  npm.cmd test -- tests/core-workflow.integration.ts tests/closure.integration.ts tests/sources.integration.ts --workers=1
}
Pop-Location
docker compose @composeArgs stop
```

新 shell 請先確認無舊的 `PLAYWRIGHT_CHANNEL`、`M3_TEST_COMPOSE_EXTRA_ARGS` 或 `M4_COMPOSE_OVERLAYS`。需圖像或 axe 證據時，在 Chromium live suite 設 `M4E_CAPTURE_DIR` 到 Git 以外或已 ignore 的資料夾。保留各自輸出中的 passed、failed、skipped 與實際版本。 [實測基準](../experiments/M4-remediation-test-results.md) · [API 合約](../contracts/M4-closure-api-contract.md)

## Record the review

由使用者保留以下實測紀錄，並將驗收決定記入 M4 ledger。

```text
Reviewer／日期（含時區）：
Branch／實際 checkout 的 commit：
親自檢查的範圍與執行命令：
實際結果（PASS／FAIL／NOT RUN，附 log、trace 或 Job ID）：
發現（severity、file:line、重現步驟、預期／實際、影響）：
覆核結論（APPROVE／REQUEST CHANGES／INCOMPLETE）：
需再覆核的範圍：
```
