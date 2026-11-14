# M4-B Acceptance Report

驗證日期為 2026-11-14（香港時間）。基線是 `98b57d3`。在修改前，M4-A 15 項 Playwright tests 均通過。

## Commands and results

從 `frontend/` 執行，Node 22.18.0、npm 10.9.3 和已安裝的 Chrome。

```powershell
npm.cmd run typecheck
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5177'
npm.cmd test
$env:M4_REAL_API = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58004'
npm.cmd test
```

- TypeScript 與 Vite production build 通過。
- Controlled Playwright 27 passed，包含原有 M4-A 15 項與 M4-B 12 項。
- Live API Playwright 3 passed，包含原有 Jobs 2 項與 Sources 1 項。
- 從 repository root 設定 `M2_TEST_DATABASE_URL` 指向隔離的 PostgreSQL（port 55436），執行 `& .venv/Scripts/python.exe -m pytest -q -rs backend/tests/m2/test_profiles_api.py backend/tests/m2/test_vertical_slice.py`。5 passed，0 skipped，7.22s。完整 172 項 backend tests 本輪 NOT RUN。
- `git diff --check 98b57d3 HEAD` 通過。Backend、Compose、PRODUCT.md 和 DESIGN.md 在兩個 commit tips 間無差異。

## Live acceptance

使用既有隔離的 Linux Docker Compose project `collection-m4a-local`，FastAPI port 58004。OpenAPI 確認 Sources / Versions 回傳陣列，沒有分頁參數。Source list、detail 和 POST 都透過同一 Vite proxy。首次成功註冊的測試資料 ID 為 `718e6edb1c714987817778317944d66e`。Browser 收到 HTTP 201，並在詳細頁顯示 Pending 和空版本狀態。獨立 GET 與 POST 回應一致。整合測試亦讀取已核准 CSV fixture `3b70bfdd286a4e39b86b33607a0362a6` 持有的既有版本及 hash。暫停該測試 project 的 PostgreSQL 時，Sources list 收到真實 HTTP 503。以 `docker compose ... up -d --wait postgres` 恢復後，Retry 載入表格。未使用開發資料庫。

## Accessibility and design review

依 Impeccable Operate、critique 和 audit 的準則，在 Chromium 檢查清單、表單及詳情。桌面保留 sidebar，平板與手機改用橫向導航。Source 名稱與 access authorization 排在前面，詳情從 access policy 進入獨立的唯讀版本表。手機初版欄寬擠壓 authorization，已調整欄寬並以實際視窗的表格座標複核。表單 error summary 取得焦點，鍵盤可用摘要連結跳至對應欄位，錯誤文字與欄位以 aria-describedby 關聯。長字串尤其是 ID、hash 和 policy 值可換行或在有名稱的表格區域橫向捲動。

- 1440、1280、768、390px 各檢查三頁。12 組無 document-level overflow，指定 WCAG A/AA axe rules 回傳零 violations。
- 390px 另檢查鍵盤提交、error summary、必填及無效 origin 錯誤、長 origin 及三種 profile statuses。桌面與手機表單使用既有設計 tokens。螢幕閱讀器、Safari 及實體手機為 NOT RUN。
- 初次 mobile detector 有兩項 `straggler` advisory，位於 Permission reference 和 Allowed dataset IDs 說明。縮短文字後，source、桌面及手機的最終掃描都回傳 `[]` 和 exit 0。未加入 detector ignores，Hooks 和 Live Mode 維持停用。

```powershell
& .agents/skills/impeccable/scripts/impeccable.cmd detect --json frontend/src
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
foreach ($view in @('1280x900','390x844')) {
  & .agents/skills/impeccable/scripts/impeccable.cmd detect --json --viewport $view http://127.0.0.1:5178/sources http://127.0.0.1:5178/sources/new http://127.0.0.1:5178/sources/3b70bfdd286a4e39b86b33607a0362a6
}
```

截圖位於本機 Codex visualization directory `m4b/`，檔名為 `list-*.png`、`form-*.png`、`detail-*.png` 和 `validation-390.png`。
