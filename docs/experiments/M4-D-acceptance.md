# M4-D Acceptance Report

驗證日期 2026-11-14（香港時間）。M4-C 文件基線 `bb7c856`，先前實作為 `b2cd571`。實作提交 `f0e7bed`，測試提交 `6f1f53b`。實際 FastAPI OpenAPI 與 checkout 比對 8 個 GET operations 和 6 個 result schemas 一致。 [API Contract Matrix](../contracts/M4-D-results-api-matrix.md)

## Browser and build gates

在 `frontend/` 執行。Node 22.18.0、npm 10.9.3、Chrome channel。

```powershell
npm.cmd run typecheck
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5190'
npm.cmd test -- --output=test-results/controlled-m4d
```

- 修改前 build 通過，40 controlled tests 與 6 live tests 通過（live API 58004）。
- 最終 typecheck 和 Vite build 通過。Controlled suite 58 passed（41.2s），含原有 40 項及 M4-D 18 項，零失敗與跳過。新案例涵蓋 keyboard、filter、pagination、返回列表、404／422／503、network retry、嵌套 JSON、長值、Clipboard、防 HTML 解譯、三組 Job counts、Quarantine 及 Evidence 導航。
- 一次並行重跑共用 Playwright artifact 目錄，兩個 teardown 報 ENOENT。最終重跑指定不同 output directories。第一次完整 live run 亦指出舊 Sources suite 缺少名為 `Controlled fixture` 的已批准 CSV Source。用既有 `create_approved_source` helper 建立專用 fixture 後重跑，既有 assertions 保留。

## Live FastAPI, PostgreSQL and worker acceptance

使用隔離 `collection-m3-test-m4d-ui`（API 58016、PostgreSQL 55448），依 README M3 Compose workflow 建立新的 named volumes、以 `docker compose ... run --rm api python -m alembic upgrade head` 初始化，並用既有本機 image 啟動 fixture、API、Redis、Dispatcher、Worker。最終命令在 `frontend/` 執行。

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5191'
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58016'
$env:M4D_COMPOSE_PROJECT = 'collection-m3-test-m4d-ui'
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m4d_ui'
$env:POSTGRES_PORT = '55448'
$env:API_PORT = '58016'
$env:POSTGRES_PASSWORD = 'unused-by-start-stop-and-exec'
# Optional. Choose an absolute path for 16 screenshots.
# $env:M4D_CAPTURE_DIR = '...'
npm.cmd test -- --workers=1 --output=test-results/live-m4d
```

最終 9 passed（34.9s），含原有 6 項和以下 3 個 M4-D 案例，零失敗與跳過。

| Workflow | 實際結果 |
| --- | --- |
| Valid HTML | `ecb5fc92-d16c-4a63-9d1a-ecd0254e351a` 成功，Valid 2、Invalid 0、Duplicates 0。River Walk、Lake View 和 HTML item 1、2；成功由 Job 開啟 Records、比對 JSON 與 API、比對 capture metadata、返回 Job 並開啟已批准 Profile。Evidence `73b7feb4-0ff2-4193-b6d0-d979ffd28f11` 的 SHA-256 為 `5d65fc9aec1cc428b872490e5e1d7049e947c47fcafb0f38eb535316940162e0`。 |
| Partial CSV | `f36f9043-4f4c-4434-a5a3-1d6dff2367a7` 為 partial，Valid 2、Invalid 3、Duplicates 1。第 5、6、7 行分別回 `required_field`、`wrong_type`、`invalid_row`。第 4 行的 duplicate 未出現在 Quarantine。Evidence `814f5d66-12ff-4ae3-82d7-f479cc5f5167` 被兩個 Records 和三個 Quarantine entries 引用，SHA-256 `15ad900bbc23656d0049eeb4dc48c51b501cd9d24cce4976876b8f138b02acfa`。 |
| Persistence and recovery | 停止專用 API 和 PostgreSQL。Vite 回報連線中斷，UI 顯示 Backend unavailable 並保留 Job ID 篩選。恢復同一服務、等待 `/health` 後，Retry 載入同一 URL。Job `02009e58-264e-41c4-8fde-1077ba17b11f` 的 Job、Record、Quarantine、Evidence 與 Profile DTOs 前後逐一相等，PostgreSQL 掛載同一 named volume。容器內以 `LocalEvidenceStore.resolve()` 取回原始 bytes，重算 SHA-256，與 API 及 CSV fixture 雙重比對。 |

測試另外用 Node SHA-256 核對 HTML 和 CSV fixture bytes 與各自 backend metadata。瀏覽器顯示 backend 保存的 hash。實際 raw bytes 的獨立重算在 Backend 測試程序執行。測試 project 完成後停止，保留 volumes。

## Backend gates

完整回歸使用 `collection-m3-test-m4d`（API 58015、PostgreSQL 55447）及獨立 Windows Redis 56391。啟動方式與 README M3 相同，使用既有 Docker test image、獨立 PostgreSQL volumes、隨機測試 DB password 及 `var/m3-redis-test` 的既有 Redis binary。測試前設定 `M3_TEST_COMPOSE_PROJECT`、`M2_TEST_COMPOSE_PROJECT` 指向該 project，`M3_TEST_COMPOSE_API_URL` 為測試 API，`M2_TEST_DATABASE_URL` 為其測試庫，`M3_TEST_BROKER_URL=redis://127.0.0.1:56391/0`，以及 `M3_TEST_REDIS_SERVER` 為測試 executable。

```powershell
& .venv/Scripts/python.exe -m pytest -q -rs --tb=short backend/tests
& .venv/Scripts/python.exe -m ruff check backend
& .venv/Scripts/python.exe -m ruff format --check backend
docker compose @composeArgs run --rm api python -m alembic upgrade head
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
git diff --check bb7c856 HEAD
```

172 passed、0 failed、0 skipped（221.16s），包含 M1 ingestion/evidence 和 M2 Record、Quarantine、Evidence 及 M3 Worker/restart 案例。Ruff lint 和格式 pass（56 files）。Alembic 為 `0005 (head)`，無 schema drift。Git scoped diff check 通過。

## Impeccable and accessibility

用已安裝 Impeccable 4.9.0 的 Operate、polish 和 audit 指引，沿用 `PRODUCT.md`、`DESIGN.md` 和現有 CSS tokens。第一次 context 將尚未建立的 `/records` 解讀為絕對檔案路徑，改用專案檔直接審閱。Hooks 和 Live Mode 維持停用。

- 實際畫面上 Job ID 的 label 曾換行，input 只能看到部分 UUID。已固定 label 及加闊 desktop input。Records table 控制欄寬，窄螢幕顯示水平捲動提示，Record ID 及 payload 為最先可見欄位。
- 手機 Record JSON 曾排在長 lineage 下方。將 payload 放在簡潔 overview 後，凍結資料的兩個 SHA-256 另在 provenance 提供較寬欄位。鍵盤翻閱 JSON 時將焦點及捲動還原到 JSON viewport。
- Quarantine 用同一組 Job counts，按實際 CSV/HTML position 命名。窄畫面將問題及 evidence 堆疊在同一列，保留具名問題清單和原始 code。
- 初次 390px rendered detector 找到 Evidence hash 說明尾行單字 advisory。加上 `text-wrap: pretty` 後再檢查。
- 真實 CSV 的 Records、Record、Quarantine、Evidence 各於 1440、1280、768、390px 截圖及檢查。16 組實際資料 axe A/AA scans 零違規，另有 16 組長資料 controlled scans 零違規。四種尺寸皆無 document-level overflow。使用 keyboard 檢查焦點、路由、橫向捲動、篩選提交及 JSON 拷貝。人工瀏覽截圖核對長 hash、結構、主要動作和狀態。Safari、實體手機、螢幕閱讀器及完整合規審核為 NOT RUN。

```powershell
& .agents/skills/impeccable/scripts/impeccable.cmd detect --json frontend/src
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$base = 'http://127.0.0.1:5189'
$job = 'f36f9043-4f4c-4434-a5a3-1d6dff2367a7'
$record = '25af2197-68df-53e1-ab9e-1c9589f62e29'
$evidence = '814f5d66-12ff-4ae3-82d7-f479cc5f5167'
$urls = @("$base/records?job_id=$job", "$base/records/$record", "$base/collection-jobs/$job/quarantine", "$base/evidence/$evidence")
foreach ($viewport in @('1440x900','1280x900','768x900','390x844')) {
  & .agents/skills/impeccable/scripts/impeccable.cmd detect --json --viewport $viewport @urls
}
```

最終 source 和 rendered detector 皆回傳 `[]`，exit 0。與 restart 共用測試服務的一次 rendered run 出現代理連線中斷，該輪不列入驗收。最後獨立啟動 API 及 Vite，先驗證四個實際資料路徑可讀，再掃描。截圖在本機 visualization directory 的 `m4d/`，檔名分別以 `records-`、`record-`、`quarantine-`、`evidence-` 起首。

## Operational limits

- API Payload 合約為 scalar-valued JSON object。Viewer 亦能瀏覽 nested JSON，透過 contract 外的 controlled fixture 測試。每次渲染約 4096 個 UTF-16 code units 並保留 surrogate pairs。Copy JSON 使用完整的 browser-parsed payload。API 仍傳輸整筆 payload，JavaScript number precision 適用於超過 safe integer 的值。
- Evidence web location 顯示 origin 及 pathname。省略 URL credentials、query、fragment 和內部 storage reference。Record Payload 由操作者檢閱及按需複製。既有 API 的 trusted local operator access 邊界仍適用。
- Evidence lookup 以已知 ID 為入口。只有 Record 或 Quarantine 提供 Job 所屬的 Evidence reference。僅保存 Evidence 且缺少結果列的 Job 無法從 Job DTO 找到該 ID。
- Teammate review 待完成。未設定 Git remote。
