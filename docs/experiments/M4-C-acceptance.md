# M4-C Acceptance Report

本報告保留當時結果。現行 Draft PUT 已加入 server-enforced revision 前置條件。見 [M4 Closure API Contract](../contracts/M4-closure-api-contract.md)。

驗證日期 2026-11-14（香港時間）。基線 `3699e75`。已對照 M1/M2 文件、Pydantic 與 FastAPI 實際 `/openapi.json`，九條 Source/Profile 路徑與 schema components 一致。

## API contract matrix

| Operation | Method and path relative to `/api/v1/sources/{source_id}` | Input and result |
| --- | --- | --- |
| Source access context | GET root | Exact authorization and controlled policy |
| History | GET `/versions` | Array ordered by version |
| New draft | POST `/versions` | `{ configuration }`, returns 201 and version |
| Open version | GET `/versions/{version_id}` | Status, config, hash and approval metadata |
| Update draft | PUT `/versions/{version_id}` | `{ configuration }`, returns normalized persisted DTO |
| Preview | POST `/versions/{version_id}/preview` | Controlled Web or CSV input, up to 5 Candidate Records |
| Validate | POST `/versions/{version_id}/validate` | Same sample input, authoritative report and outcome |
| Approve | POST `/versions/{version_id}/approve` | `{ approver, report_id, config_hash }`, returns immutable version |

Record Schema and config schema use version `1`. Fields support string, integer, finite number and boolean. HTML supports CSS/XPath and per-field override, text/attribute extraction and URL resolution. CSV maps one header per output field. Sample input is the allowed origin plus a document path, or the allowed dataset ID plus inline UTF-8 CSV up to 1 MiB.

## Commands and results

前端從 `frontend/` 執行。Node 22.18.0、npm 10.9.3、Chrome channel。

```powershell
npm.cmd run typecheck
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5179'
npm.cmd test
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58004'
npm.cmd test
```

- 基線 build 通過，M4-A/B 原有 27 tests passed。
- 最終 typecheck 與 Vite production build 通過。40 controlled tests passed (30.3s)。6 live tests passed (5.6s)，包含 Jobs 2 項、Sources 1 項、Profiles 3 項。
- 隔離 `collection-m4a-local` 的 API 發佈至 `127.0.0.1:58004`。受控 HTML 與 CSV 都完成新增、儲存、Preview、Validate、明確 Approval、唯讀重載和 PUT 409。CSV fixture 也展示真實失敗報告。將伺服器配置改動後還原到同一 hash，舊報告仍因 revision 失效而被後端拒絕。重新 Validate 後才成功批准。
- 發出跨來源請求、沒有 Origin 的請求，以及向 production preview 發出同源核准請求，皆收到 Vite 403。已通過 Validate 的 fixture Source 撤銷 access 後，通過 demo proxy 的核准請求仍被 FastAPI 以 `source_not_approved` 拒絕。
- HTML `e9071721c70648bb8aa888961bb52369` 和 CSV `3aeed954741d48d6b1625dc852115d4f` 的完整 DTO 在 `docker compose -p collection-m4a-local -f compose.yaml -f compose.fixture.yaml restart api` 前後一致，Chrome 重開唯讀頁可見相同 hash。另透過既有 API 退役一筆專用 HTML fixture，確認歷史仍顯示原有 config、hash 與 approver。

完整 Backend regression 使用另一隔離 project `collection-m3-test-m4c`（API 58005、PostgreSQL 55437、原生測試 Redis 56381）。設定 M2/M3 測試環境變數，依 README 啟動 Compose 和專用 Redis。從 repository root 執行：

```powershell
& .venv/Scripts/python.exe -m pytest -q -rs --tb=short backend/tests
& .venv/Scripts/python.exe -m ruff check backend
& .venv/Scripts/python.exe -m ruff format --check backend
```

172 passed、0 failed、0 skipped（217.40s）。Ruff check 通過，56 files already formatted。Compose API 容器的 `python -m alembic upgrade head`、`python -m alembic current --check-heads` 及 `python -m alembic check` 通過，回報 `0005 (head)` 且沒有 schema drift。已停止該回歸 project。

## Design and accessibility

沿用 Impeccable 4.9.0、FYP frontend skill、PRODUCT.md 和 DESIGN.md。以 Operate 模式檢查欄位分組、目前狀態、錯誤復原和唯讀流程。第一輪渲染發現 `nested-cards` 及停用主按鈕的 `gray-on-color`。已用細分隔線保留欄位分組，停用按鈕改用既有 surface。最終 source 及 1280、390 的 live 渲染掃描全為 `[]`、exit 0。

```powershell
& .agents/skills/impeccable/scripts/impeccable.cmd detect --json frontend/src
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$base = 'http://127.0.0.1:5178/sources/3b70bfdd286a4e39b86b33607a0362a6/profiles/'
foreach ($view in @('1280x900','390x844')) {
  & .agents/skills/impeccable/scripts/impeccable.cmd detect --json --viewport $view ($base+'new') ($base+'03ea7b69e4a546f28f5ce87313c26f0e') ($base+'2c760cb374a043208ae5bef31a37328f')
}
```

實際查看 1440、1280、768、390px 的 Draft（含真實 Preview、Report 和 Approval review）與 Approved 畫面。8 組 axe A/AA 掃描零違規、無 document-level overflow。另查看 390px HTML Editor。Playwright 驗證鍵盤提交、可見且有名稱的錯誤、離開未儲存變更的提示與唯讀語意。寬表格在窄畫面內橫向捲動。Chrome 模擬 viewport，Safari、實體裝置與螢幕閱讀器未測。Hooks 與 Live Mode 維持停用。

## Operational limits

核准功能只在 opt-in 的 loopback Vite development proxy 開啟，使用 loopback peer、Host 及同源 Origin 檢查。FastAPI 本身仍是既有可信本機操作者服務，直接呼叫不會經過 Vite。Approver 是自報 audit label。現有 PUT 無 ETag、revision token 或條件寫入。前端在提交前重讀 hash 與狀態，可阻止可見的衝突，但兩個請求之間仍有競態。Report 的 revision、當前 hash、Source 授權及 immutability 由 Backend 保證。
