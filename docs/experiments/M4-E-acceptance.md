# M4-E Acceptance Report

本報告保留 M4-E 階段數據。現行 HEAD 的回歸與跨瀏覽器資料見 [M4 Closure Remediation Results](M4-remediation-test-results.md)。

2026-11-14（香港時間）。基線 `2eeb72b`，分支 `feature/M4E-frontend-integration`。Git remote 未設定。驗收使用 Chrome 157.0.8103.51、Node 22.18.0、npm 10.9.3 及既有 Docker image。 [Job submission contract](../contracts/M4-E-job-submission-contract.md)

## Frontend and Backend gates

M4-D baseline build 通過，58 controlled tests 通過（39.2s）。M4-E TypeScript 與 Vite build 通過，74 controlled tests 通過（55.1s）。最終文案調整亦重跑兩個 Jobs suites。新案例覆蓋 HTML／CSV、選擇及 eligibility、UTF-8 上限、HTTP 403／409／422／503、network／10 秒 timeout、同 key replay、返回帶篩選分頁的 Jobs、鍵盤、四種 viewport 和 pending → running → partial。初次 polling regression mock 根據 fetch 計數推進狀態，在 React StrictMode 可能略過 pending 並重複 mount preview。改由已觀察的 UI 狀態推進 mock，並核對終態後停止發出 status 和 records requests。

```powershell
# frontend/
npm.cmd run typecheck
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5193'
npm.cmd test -- --output=test-results/m4e-baseline # baseline checkout
npm.cmd test -- --output=test-results/m4e-controlled-verified # M4-E
npm.cmd test -- tests/jobs.spec.ts tests/job-create.spec.ts --output=test-results/m4e-polish

# repository root
& .venv/Scripts/python.exe -m pytest -q -rs --tb=short backend/tests
& .venv/Scripts/python.exe -m ruff check backend
& .venv/Scripts/python.exe -m ruff format --check backend
docker compose @composeArgs exec -T api python -m alembic upgrade head
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
git diff --check 2eeb72b HEAD
```

Backend regression 使用 `collection-m3-test-m4e`、API 58017、PostgreSQL 55449 和獨立本機 Redis 56392。用 README 的 M3 測試環境設定 `M3_TEST_COMPOSE_PROJECT`、`M3_TEST_COMPOSE_API_URL`、`M2_TEST_COMPOSE_PROJECT`、`M2_TEST_DATABASE_URL`、`M3_TEST_BROKER_URL`、`M3_TEST_REDIS_SERVER`。Redis binary 來自既有 `var/m3-redis-test`，使用 `--port 56392 --bind 127.0.0.1 --appendonly no --save ""`。完整 regression 172 passed（226.62s），0 skipped。Ruff 通過、56 檔格式通過、Alembic `0005 (head)`、無 drift。結果包括既有真實 broker outage／recovery 測試。M4-E browser 故障案例停止的是 API 和 PostgreSQL。測試專案皆以 `stop` 保留 volumes。

## Real browser E2E

隔離 project `collection-m3-test-m4e-ui`，API 58018、PostgreSQL 55450。依 M3 fixture overlay 啟動 PostgreSQL、FastAPI、Redis、Dispatcher、Celery prefork worker 和 HTML fixture server。既有 `create_approved_source`、`submit_job` helpers 建立舊 Sources／Jobs suites 所需的 `Controlled fixture` 和一筆 partial Job。新 E2E 自行經 React 建立各案例的 Source 和 Profile，再以 fixture setup 的可信 terminal API 方式做 Source authorization。

```powershell
# frontend/ with isolated services running
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5194'
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58018'
$env:M4E_COMPOSE_PROJECT = 'collection-m3-test-m4e-ui'
$env:M4D_COMPOSE_PROJECT = $env:M4E_COMPOSE_PROJECT
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m3_test'
$env:POSTGRES_PORT = '55450'
$env:API_PORT = '58018'
$env:POSTGRES_PASSWORD = 'unused-by-start-stop-and-exec'
# Set M4E_CAPTURE_DIR to an absolute path for browser captures.
npm.cmd test -- --workers=1 --output=test-results/m4e-live-final
# Focused screenshot recheck after the final wording adjustment. Set M4_FRONTEND_PORT=5196.
npm.cmd test -- tests/core-workflow.integration.ts --grep 'Core web workflow' --workers=1 --output=test-results/m4e-jobs-capture
```

**12 passed（1.2m）**，原有 9 項通過及 M4-E 新增 3 項通過。Browser 在收到 POST 201 Pending 後開啟 Job Detail。實際事件均依序 `JOB_CREATED → DISPATCHED → CLAIMED → SUCCEEDED/PARTIAL`。本輪 fixtures 很快，Running 可從 CLAIMED 追查，受控 polling 測試另觀察畫面上的 Running。

| Workflow | 實際結果 |
| --- | --- |
| HTML | Job `fdb62ba9-930d-43db-8098-20590a4b7b48` 於 12:40:04.310 HKT 新建，12:40:04.508 完成。Succeeded，2 Valid、0 Invalid、0 Duplicates。Profile `11968b0a7a8c403191e621d1e72c3f58`，Record `47a1c9c0-260a-5f50-a674-f1ad9ea52754`，Evidence `96fa10fc-bd81-4ed9-8a3d-71be3855905d`。 |
| CSV | Job `6d363930-0857-4806-8e9d-cd956e62c7d8` 於 12:40:16.522 HKT 新建，12:40:16.580 完成。Partial，2 Valid、3 Invalid、1 Duplicate。Quarantine 起始行 5、6、7。Profile `ee8cbe542aa74eadbeeb1e52226d5c2c`，Record `605f2ea7-8df9-551d-99d1-42e8098d1c82`，Evidence `0e9da6a0-e43b-41fb-b782-6a3e5d417514`。 |
| Rejections | Pending Source 和已批准 Profile 的並存情況在 POST 回 403。Draft 回 409，非法 body 回 422，未批准 dataset 回 403。失敗 Validation report 無 Approve action，請求亦由真實 API 以 409 拒絕。既有 live suite 通過 stale report、撤銷 Source permissions 和 Approved PUT 409。首次測試錯把 Draft 與 Pending 同時存在時的 response 預期為 403，依 backend gate 順序拆開驗證。 |
| Recovery and persistence | 停止專用 FastAPI 和 PostgreSQL 時，表單顯示結果未獲確認並保留輸入。重新啟動同一服務和 volumes，Retry POST 重用完全相同的 body，201 建立 `5afbc25e-c962-4321-85d0-9a872089fd5b`，再重播得到 200 和同一 ID。重啟前後 Source、Profile、Job、Events、Records、Quarantine、Evidence DTO 逐一相等。M4-D live case 另核對 named volume 及後端原始 bytes 的 SHA-256。 |

HTML Evidence SHA-256 為 `5d65fc9aec1cc428b872490e5e1d7049e947c47fcafb0f38eb535316940162e0`。CSV 為 `15ad900bbc23656d0049eeb4dc48c51b501cd9d24cce4976876b8f138b02acfa`。瀏覽器核對畫面 metadata 與實際 API。Node 比對 fixture digest，backend store 另驗證持久化 bytes。Frontend 只讀 Evidence Metadata。

## UX and accessibility findings

使用已安裝 Impeccable 4.9.0 的 Operate、audit 和 polish 指引。沿用既有 light-first tokens、shell、table、表單和狀態。實際 Chrome 截圖按 1440／1280／768／390px 檢查 Collection Jobs list、Sources list、Source create/detail、Configuration／Preview／Validation／Approval、Approved Profile、HTML／CSV Job form/detail、Records list/detail、Quarantine 與 Evidence。14 states × 4 widths 的 56 組 app-wide axe A/AA 無違規、無 global horizontal overflow。測試另驗證鍵盤提交、可見焦點、具名的表單錯誤、disabled options、窄畫面的捲動區及長 identifier／JSON。現有確認流程使用 inline approval 及既有瀏覽器確認框。新增表單直接顯示 page-level feedback，無自訂 modal。

| Severity | Finding | Change and recheck |
| --- | --- | --- |
| Medium | 選擇版本與提交原本是分斷流程，操作者需自行組合 API request。 | 從已核准 Profile 帶入真實版本。已批准 Source 有可用版本才顯示 contextual action。新表單留存 backend rejection 和 uncertain write 回復路徑。 |
| Medium | 小畫面 textarea 只顯示部分 fixture，失敗時需要辨識哪個輸入有誤。 | 7 rows、等寬 CSV，縮短提示，正確欄位綁定 error。390px Chrome capture 加鍵盤／axe 重查。 |
| Advisory | Partial 說明在 1280 和 390px 遺留單字 `separately.`，第一輪簡化後 390px 仍有孤行。 | 縮短為「See quarantine for rejected candidates.」。結果 counts 仍獨立顯示，重跑 Jobs suites 及 detector。 |

手動按 sRGB 公式核對代表性相鄰色。Primary 白字對 teal 6.89:1，secondary 白底 5.56:1，Partial 警告 4.91:1，error 白底 5.85:1，focus 白底 4.91:1，field 邊界白底 3.52:1。Safari、實體手機、螢幕閱讀器和全面 WCAG conformance 為 NOT RUN。

```powershell
# repository root, with Vite on 5195 and the isolated API up
& .agents/skills/impeccable/scripts/impeccable.cmd detect --json frontend/src
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:IMPECCABLE_SKILL_DIR = (Resolve-Path '.agents/skills/impeccable').Path
$detector = Join-Path $env:IMPECCABLE_SKILL_DIR 'scripts/bin/windows-x64/impeccable.exe'
foreach ($vp in @('1280x900','390x844')) {
  & $detector detect --json --viewport $vp @urls
}
```

`@urls` 包含 Collection Jobs list/new/detail、Sources list/new/detail、Approved Profile、Records list/detail、Quarantine 及 Evidence。Job form 使用上述 CSV Job 的 Source、Profile query params。Windows batch launcher 初次拆開含 `&` 的 URL，直接使用同一安裝的 engine（`0.1.23`）保留完整參數。最終 source scan 和兩次 rendered scans 均回傳 `[]`、exit 0。UI screenshots 位於此次本機 visualization 目錄 `m4e/`。Hooks、Live Mode 未啟用。

[Demo runbook](../demo/M4-core-demo-runbook.md) · [Issue Manifest](M4-E-issue-manifest.md) · [M5 readiness](M5-readiness-review.md)
